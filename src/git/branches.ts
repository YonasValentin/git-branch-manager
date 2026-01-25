import * as vscode from 'vscode';
import { exec, getCurrentBranch, getBaseBranch } from './core';
import { calculateHealthScore, getHealthStatus, getHealthReason, extractIssueFromBranch } from './health';
import { BranchInfo, RemoteBranchInfo, ComparisonResult, CommitInfo, FileChange } from '../types';

/**
 * Retrieves branch information with health metrics.
 * Uses batch git queries for optimal performance.
 * @param cwd - Working directory
 * @returns Array of branch information with health scores
 */
export async function getBranchInfo(cwd: string): Promise<BranchInfo[]> {
  const branches: BranchInfo[] = [];

  try {
    const { stdout: branchCheck } = await exec('git branch', { cwd });
    if (!branchCheck.trim()) return [];

    const currentBranch = await getCurrentBranch(cwd);
    const baseBranch = await getBaseBranch(cwd);

    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const protectedBranches = config.get<string[]>('protectedBranches', [
      'main', 'master', 'develop', 'dev', 'staging', 'production',
    ]);
    const protectedSet = new Set(protectedBranches);
    const daysUntilStale = config.get<number>('daysUntilStale', 30);

    const { stdout: mergedBranches } = await exec(
      `git branch --merged ${JSON.stringify(baseBranch)} --format="%(refname:short)"`,
      { cwd }
    );
    const mergedSet = new Set(mergedBranches.trim().split('\n').filter((b) => b));

    // Batch fetch branch metadata via for-each-ref (single git call)
    const branchDataMap: Map<string, { timestamp: number; author: string; trackingStatus: string }> = new Map();
    let useBatchRef = true;

    try {
      const { stdout: refOutput } = await exec(
        `git for-each-ref --format="%(refname:short)|%(committerdate:unix)|%(authorname)|%(upstream:track)" refs/heads/`,
        { cwd }
      );

      for (const line of refOutput.trim().split('\n')) {
        if (!line) continue;
        const parts = line.split('|');
        if (parts.length >= 3) {
          branchDataMap.set(parts[0], {
            timestamp: parseInt(parts[1]) || 0,
            author: parts[2] || '',
            trackingStatus: parts[3] || '',
          });
        }
      }
    } catch (err) {
      console.warn('for-each-ref unavailable, using per-branch queries:', err);
      useBatchRef = false;
    }

    // Parse tracking info for gone remote detection
    const trackingInfo: Map<string, { remote: string; gone: boolean }> = new Map();
    try {
      const { stdout: trackingOutput } = await exec('git branch -vv', { cwd });
      for (const line of trackingOutput.split('\n')) {
        const match = line.match(/^\*?\s+(\S+)\s+\S+\s+\[([^\]]+)\]/);
        if (match) {
          const [, name, ref] = match;
          trackingInfo.set(name, { remote: ref.split(':')[0], gone: ref.includes(': gone') });
        }
      }
    } catch {}

    const { stdout: localBranches } = await exec('git branch --format="%(refname:short)"', { cwd });
    const branchList = localBranches.trim().split('\n').filter(b => b && !protectedSet.has(b));

    // Parallel fetch ahead/behind counts for active branches
    const aheadBehindMap: Map<string, { ahead: number; behind: number }> = new Map();
    const activeBranches = branchList.filter(b => !mergedSet.has(b) && b !== currentBranch);

    const BATCH_SIZE = 10;
    for (let i = 0; i < activeBranches.length; i += BATCH_SIZE) {
      const batch = activeBranches.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (branch) => {
          try {
            const { stdout: revList } = await exec(
              `git rev-list --left-right --count ${JSON.stringify(baseBranch)}...${JSON.stringify(branch)}`,
              { cwd }
            );
            const [behindStr, aheadStr] = revList.trim().split('\t');
            return { branch, behind: parseInt(behindStr) || 0, ahead: parseInt(aheadStr) || 0 };
          } catch {
            return { branch, behind: 0, ahead: 0 };
          }
        })
      );
      results.forEach(r => aheadBehindMap.set(r.branch, { ahead: r.ahead, behind: r.behind }));
    }

    for (const branch of branchList) {
      try {
        const isMerged = mergedSet.has(branch);
        let timestamp: number;
        let author: string | undefined;

        if (useBatchRef && branchDataMap.has(branch)) {
          const data = branchDataMap.get(branch)!;
          timestamp = data.timestamp;
          author = data.author || undefined;
        } else {
          try {
            const { stdout: dateStr } = await exec(`git log -1 --format=%ct ${JSON.stringify(branch)}`, { cwd });
            timestamp = parseInt(dateStr.trim());
          } catch {
            timestamp = 0;
          }
          try {
            const { stdout: authorStr } = await exec(`git log -1 --format=%an ${JSON.stringify(branch)}`, { cwd });
            author = authorStr.trim();
          } catch {}
        }

        const lastCommitDate = new Date(timestamp * 1000);
        const daysOld = isNaN(timestamp) || timestamp === 0 ? 0 : Math.floor((Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24));
        const aheadBehind = aheadBehindMap.get(branch) || { ahead: 0, behind: 0 };
        const tracking = trackingInfo.get(branch);

        const info: BranchInfo = {
          name: branch,
          isMerged,
          lastCommitDate,
          daysOld,
          isCurrentBranch: branch === currentBranch,
          ahead: aheadBehind.ahead,
          behind: aheadBehind.behind,
          author,
          linkedIssue: extractIssueFromBranch(branch),
          hasRemote: !!tracking,
          remoteGone: tracking?.gone || false,
          trackingBranch: tracking?.remote,
        };

        info.healthScore = calculateHealthScore(info, daysUntilStale);
        info.healthStatus = getHealthStatus(info.healthScore);
        info.healthReason = getHealthReason(info);

        branches.push(info);
      } catch (err) {
        console.error(`Failed to process branch ${branch}:`, err);
      }
    }
  } catch (err) {
    console.error('getBranchInfo failed:', err);
    return [];
  }

  return branches.sort((a, b) => (a.healthScore || 100) - (b.healthScore || 100));
}

/**
 * Retrieves remote branch metadata with merge status against the base branch.
 * Prunes stale remote-tracking refs before fetching.
 * @param cwd - Working directory
 * @returns Array of remote branch information
 */
export async function getRemoteBranchInfo(cwd: string): Promise<RemoteBranchInfo[]> {
  const remoteBranches: RemoteBranchInfo[] = [];

  try {
    await exec('git fetch --prune', { cwd });

    const baseBranch = await getBaseBranch(cwd);
    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const protectedBranches = config.get<string[]>('protectedBranches', [
      'main', 'master', 'develop', 'dev', 'staging', 'production',
    ]);
    const protectedSet = new Set(protectedBranches);

    const { stdout: mergedRemotes } = await exec(
      `git branch -r --merged origin/${baseBranch} --format="%(refname:short)"`,
      { cwd }
    );
    const mergedSet = new Set(mergedRemotes.trim().split('\n').filter((b) => b));

    // Batch fetch remote ref timestamps
    const remoteDataMap: Map<string, number> = new Map();
    let useBatchRef = true;

    try {
      const { stdout: refOutput } = await exec(
        `git for-each-ref --format="%(refname:short)|%(committerdate:unix)" refs/remotes/`,
        { cwd }
      );

      for (const line of refOutput.trim().split('\n')) {
        if (!line) continue;
        const [refName, ts] = line.split('|');
        if (refName) remoteDataMap.set(refName, parseInt(ts) || 0);
      }
    } catch (err) {
      console.warn('for-each-ref unavailable for remotes:', err);
      useBatchRef = false;
    }

    const { stdout: remotes } = await exec('git branch -r --format="%(refname:short)"', { cwd });

    for (const remoteBranch of remotes.trim().split('\n')) {
      if (!remoteBranch || remoteBranch.includes('HEAD')) continue;

      const [remote, ...nameParts] = remoteBranch.split('/');
      const branchName = nameParts.join('/');

      if (protectedSet.has(branchName)) continue;

      let daysOld = 0;
      let lastCommitDate: Date | undefined;

      if (useBatchRef && remoteDataMap.has(remoteBranch)) {
        const timestamp = remoteDataMap.get(remoteBranch)!;
        lastCommitDate = new Date(timestamp * 1000);
        daysOld = timestamp ? Math.floor((Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      } else {
        try {
          const { stdout: dateStr } = await exec(`git log -1 --format=%ct ${JSON.stringify(remoteBranch)}`, { cwd });
          const timestamp = parseInt(dateStr.trim());
          lastCommitDate = new Date(timestamp * 1000);
          daysOld = isNaN(timestamp) ? 0 : Math.floor((Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24));
        } catch {}
      }

      remoteBranches.push({
        name: branchName,
        remote,
        lastCommitDate,
        daysOld,
        isMerged: mergedSet.has(remoteBranch),
        isGone: false,
      });
    }
  } catch (err) {
    console.error('getRemoteBranchInfo failed:', err);
  }

  return remoteBranches;
}

/**
 * Gets all branch names for comparison dropdown.
 * @param cwd - Working directory
 * @returns Array of branch names
 */
export async function getAllBranchNames(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git branch --format="%(refname:short)"', { cwd });
    return stdout.trim().split('\n').filter(b => b);
  } catch {
    return [];
  }
}

/**
 * Renames a branch.
 * @param cwd - Working directory
 * @param oldName - Current branch name
 * @param newName - New branch name
 * @returns Success status
 */
export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<boolean> {
  try {
    await exec(`git branch -m ${JSON.stringify(oldName)} ${JSON.stringify(newName)}`, { cwd });
    return true;
  } catch (error) {
    console.error('Error renaming branch:', error);
    return false;
  }
}

/**
 * Deletes a branch without confirmation (for bulk operations).
 * @param cwd - Working directory
 * @param branchName - Branch to delete
 * @returns Success status
 */
export async function deleteBranchForce(cwd: string, branchName: string): Promise<boolean> {
  try {
    await exec(`git branch -D -- ${JSON.stringify(branchName)}`, { cwd });
    return true;
  } catch (error) {
    console.error('Error deleting branch:', error);
    return false;
  }
}

/**
 * Compares two branches and returns detailed comparison data.
 * @param cwd - Working directory
 * @param branchA - First branch (source)
 * @param branchB - Second branch (target)
 * @returns Comparison result with commits and file changes
 */
export async function compareBranches(cwd: string, branchA: string, branchB: string): Promise<ComparisonResult> {
  const result: ComparisonResult = {
    branchA,
    branchB,
    ahead: 0,
    behind: 0,
    commitsA: [],
    commitsB: [],
    files: [],
    mergeBase: '',
  };

  try {
    // Get ahead/behind counts
    const { stdout: countOutput } = await exec(
      `git rev-list --left-right --count ${JSON.stringify(branchB)}...${JSON.stringify(branchA)}`,
      { cwd }
    );
    const [behindStr, aheadStr] = countOutput.trim().split('\t');
    result.behind = parseInt(behindStr) || 0;
    result.ahead = parseInt(aheadStr) || 0;

    // Get merge base
    try {
      const { stdout: mergeBase } = await exec(
        `git merge-base ${JSON.stringify(branchA)} ${JSON.stringify(branchB)}`,
        { cwd }
      );
      result.mergeBase = mergeBase.trim().substring(0, 7);
    } catch {}

    // Get commits unique to branchA (ahead commits)
    if (result.ahead > 0) {
      const { stdout: commitsA } = await exec(
        `git log ${JSON.stringify(branchB)}..${JSON.stringify(branchA)} --pretty=format:"%h|%s|%an|%cr" --reverse`,
        { cwd, maxBuffer: 1024 * 1024 }
      );
      result.commitsA = commitsA.trim().split('\n').filter(l => l).map(line => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date, daysOld: 0 };
      });
    }

    // Get commits unique to branchB (behind commits)
    if (result.behind > 0) {
      const { stdout: commitsB } = await exec(
        `git log ${JSON.stringify(branchA)}..${JSON.stringify(branchB)} --pretty=format:"%h|%s|%an|%cr" --reverse`,
        { cwd, maxBuffer: 1024 * 1024 }
      );
      result.commitsB = commitsB.trim().split('\n').filter(l => l).map(line => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date, daysOld: 0 };
      });
    }

    // Get file changes between branches
    const { stdout: filesOutput } = await exec(
      `git diff --name-status ${JSON.stringify(branchB)}..${JSON.stringify(branchA)}`,
      { cwd, maxBuffer: 1024 * 1024 }
    );
    result.files = filesOutput.trim().split('\n').filter(l => l).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { status: status.charAt(0) as 'A' | 'M' | 'D' | 'R', path: pathParts.join('\t') };
    });

  } catch (error) {
    console.error('Error comparing branches:', error);
  }

  return result;
}
