import * as vscode from 'vscode';
import type { CleanupRule, CommitInfo, FileChange, BranchInfo } from '../types';
import { reqStr, reqStrArray, reqNum, isCleanupRuleArray } from './messageValidators';
import { requireValidRef } from './validateRef';
import { validateRegexPattern } from '../utils/regex';

export interface DispatchUI {
  showInfo: (message: string) => void;
  showWarning: (message: string) => void;
  showError: (message: string) => void;
  showInputBox: (opts: vscode.InputBoxOptions) => Thenable<string | undefined>;
  showWarningModal: (message: string, ...items: string[]) => Thenable<string | undefined>;
  showInfoModal: (message: string, ...items: string[]) => Thenable<string | undefined>;
}

export interface DispatchEnv {
  openExternal: (uri: string) => Thenable<boolean>;
  executeCommand: <T = unknown>(command: string, ...args: unknown[]) => Thenable<T>;
  clipboardRead: () => Thenable<string>;
  clipboardWrite: (text: string) => Thenable<void>;
}

export interface DispatchGit {
  deleteBranchForce: (cwd: string, name: string) => Promise<unknown>;
  checkout: (cwd: string, name: string) => Promise<unknown>;
  rename: (cwd: string, oldName: string, newName: string) => Promise<unknown>;
  compare: (cwd: string, a: string, b: string) => Promise<{ commitsA?: CommitInfo[]; commitsB?: CommitInfo[]; files?: FileChange[] }>;
  timeline: (cwd: string, name: string, limit: number) => Promise<CommitInfo[]>;
  branchInfo: (cwd: string) => Promise<BranchInfo[]>;
  createStash: (cwd: string, msg?: string) => Promise<unknown>;
  applyStash: (cwd: string, idx: number) => Promise<unknown>;
  popStash: (cwd: string, idx: number) => Promise<unknown>;
  dropStash: (cwd: string, idx: number) => Promise<unknown>;
  clearStashes: (cwd: string) => Promise<unknown>;
}

export interface DispatchStorage {
  saveBranchNote: (ctx: vscode.ExtensionContext, root: string, name: string, note: string) => Promise<void>;
  getCleanupRules: (ctx: vscode.ExtensionContext, root: string) => CleanupRule[];
  saveCleanupRules: (ctx: vscode.ExtensionContext, root: string, rules: CleanupRule[]) => Promise<void>;
  evaluateCleanupRule: (branches: BranchInfo[], rule: CleanupRule) => BranchInfo[];
  removeRecoveryEntry: (ctx: vscode.ExtensionContext, root: string, name: string, hash: string) => Promise<void>;
  restoreFromLog: (ctx: vscode.ExtensionContext, root: string, name: string, hash: string) => Promise<{ success: boolean; error?: string }>;
}

export interface DispatchHooks {
  createBranchFromTemplate: () => Promise<void>;
  createWorktreeFromBranch: () => Promise<void>;
  getGitHubToken: (silent?: boolean) => Promise<string | undefined>;
  recordBranchDeleted: (count: number) => Promise<void>;
  selectRepository: () => Promise<string | undefined>;
  setActiveRepository: (path: string) => Promise<void>;
  discoverRepositories: () => Promise<unknown>;
  getRepositoriesCount: () => number;
  branchTreeRefresh: () => void;
  openDiff: (branchA: string, branchB: string, filePath: string, gitRoot: string) => Promise<void>;
}

export interface WebviewMessageDeps {
  context: vscode.ExtensionContext;
  gitRoot: string;
  ui: DispatchUI;
  env: DispatchEnv;
  git: DispatchGit;
  storage: DispatchStorage;
  hooks: DispatchHooks;
  post: (msg: unknown) => void;
  updateWebview: () => Promise<void>;
  updateStatusBar: () => Promise<void>;
}

export async function dispatchWebviewMessage(
  message: unknown,
  deps: WebviewMessageDeps,
): Promise<void> {
  if (!message || typeof message !== 'object') return;
  const m = message as Record<string, unknown>;
  if (typeof m.command !== 'string') return;

  const { context, gitRoot, ui, env, git, storage, hooks, post, updateWebview, updateStatusBar } = deps;

  switch (m.command) {
    case 'delete':
      try {
        const delBranch = requireValidRef(reqStr(m.branchName, 'branchName'), 'branchName');
        await git.deleteBranchForce(gitRoot, delBranch);
        ui.showInfo(`Deleted branch: ${delBranch}`);
        await hooks.recordBranchDeleted(1);
        await updateWebview();
        await updateStatusBar();
      } catch (error) {
        ui.showError(`Failed to delete branch: ${error}`);
      }
      break;

    case 'deleteMultiple': {
      const branchesToDelete = reqStrArray(m.branchNames, 'branchNames').map((b) => requireValidRef(b, 'branchNames'));
      const results = { success: [] as string[], failed: [] as Array<{ branch: string; error: string }> };

      for (const branch of branchesToDelete) {
        try {
          await git.deleteBranchForce(gitRoot, branch);
          results.success.push(branch);
        } catch (error) {
          results.failed.push({ branch, error: String(error) });
        }
      }

      await hooks.recordBranchDeleted(results.success.length);

      if (results.success.length > 0) {
        ui.showInfo(`Deleted ${results.success.length} branches`);
      }
      if (results.failed.length > 0) {
        ui.showWarning(`Failed to delete ${results.failed.length} branches`);
      }

      await updateWebview();
      await updateStatusBar();
      break;
    }

    case 'switch':
      try {
        const switchBranchName = requireValidRef(reqStr(m.branchName, 'branchName'), 'branchName');
        await git.checkout(gitRoot, switchBranchName);
        ui.showInfo(`Switched to branch: ${switchBranchName}`);
        await updateWebview();
        await updateStatusBar();
      } catch (error) {
        ui.showError(`Failed to switch branch: ${error}`);
      }
      break;

    case 'createStash':
      try {
        const stashMessage = await ui.showInputBox({
          prompt: 'Stash message (optional)',
          placeHolder: 'WIP: feature work',
        });
        if (stashMessage !== undefined) {
          await git.createStash(gitRoot, stashMessage || undefined);
          ui.showInfo('Created stash');
          await updateWebview();
        }
      } catch (error) {
        ui.showError(`Failed to create stash: ${error}`);
      }
      break;

    case 'applyStash':
      try {
        const idx = reqNum(m.index, 'index');
        await git.applyStash(gitRoot, idx);
        ui.showInfo(`Applied stash ${idx}`);
        await updateWebview();
      } catch (error) {
        ui.showError(`Failed to apply stash: ${error}`);
      }
      break;

    case 'popStash':
      try {
        const idx = reqNum(m.index, 'index');
        await git.popStash(gitRoot, idx);
        ui.showInfo(`Popped stash ${idx}`);
        await updateWebview();
      } catch (error) {
        ui.showError(`Failed to pop stash: ${error}`);
      }
      break;

    case 'dropStash':
      try {
        const idx = reqNum(m.index, 'index');
        await git.dropStash(gitRoot, idx);
        ui.showInfo(`Dropped stash ${idx}`);
        await updateWebview();
      } catch (error) {
        ui.showError(`Failed to drop stash: ${error}`);
      }
      break;

    case 'clearStashes': {
      const confirm = await ui.showWarningModal(
        'Are you sure you want to clear all stashes? This cannot be undone.',
        'Clear All',
      );
      if (confirm === 'Clear All') {
        try {
          await git.clearStashes(gitRoot);
          ui.showInfo('Cleared all stashes');
          await updateWebview();
        } catch (error) {
          ui.showError(`Failed to clear stashes: ${error}`);
        }
      }
      break;
    }

    case 'compareBranches':
      try {
        const branchA = requireValidRef(reqStr(m.branchA, 'branchA'), 'branchA');
        const branchB = requireValidRef(reqStr(m.branchB, 'branchB'), 'branchB');
        const comparison = await git.compare(gitRoot, branchA, branchB);
        post({
          command: 'comparisonResult',
          data: {
            ahead: (comparison.commitsA ?? []).map((c: CommitInfo) => ({ hash: c.hash, message: c.message, author: c.author, date: c.date })),
            behind: (comparison.commitsB ?? []).map((c: CommitInfo) => ({ hash: c.hash, message: c.message, author: c.author, date: c.date })),
            files: (comparison.files ?? []).map((f: FileChange) => ({ path: f.path, status: f.status, additions: 0, deletions: 0 })),
          },
        });
      } catch (error) {
        ui.showError(`Failed to compare branches: ${error}`);
      }
      break;

    case 'getTimeline':
      try {
        const branchName = requireValidRef(reqStr(m.branchName, 'branchName'), 'branchName');
        const timeline = await git.timeline(gitRoot, branchName, 5);
        post({ command: 'timelineResult', data: { branchName, commits: timeline } });
      } catch {
        // Timeline is supplementary — silent failure
      }
      break;

    case 'renameBranch':
      try {
        const oldName = requireValidRef(reqStr(m.oldName, 'oldName'), 'oldName');
        const newName = await ui.showInputBox({
          prompt: 'New branch name',
          value: oldName,
          validateInput: (value) => {
            if (!value) return 'Branch name cannot be empty';
            if (value === oldName) return 'New name must be different';
            return null;
          },
        });

        if (newName) {
          await git.rename(gitRoot, oldName, newName);
          ui.showInfo(`Renamed ${oldName} to ${newName}`);
          await updateWebview();
          await updateStatusBar();
        }
      } catch (error) {
        ui.showError(`Failed to rename branch: ${error}`);
      }
      break;

    case 'batchRename':
      try {
        const pattern = reqStr(m.pattern, 'pattern');
        const replacement = reqStr(m.replacement, 'replacement');
        const branchesToRename = reqStrArray(m.branches, 'branches');

        const validation = validateRegexPattern(pattern);
        if (!validation.valid) {
          ui.showError(`Invalid regex pattern: ${validation.error}`);
          return;
        }

        const regex = new RegExp(pattern);

        const renames: Array<{ old: string; new: string }> = [];
        for (const branch of branchesToRename) {
          if (regex.test(branch)) {
            const newName = branch.replace(regex, replacement);
            if (newName !== branch) {
              renames.push({ old: branch, new: newName });
            }
          }
        }

        if (renames.length === 0) {
          ui.showInfo('No branches matched the pattern');
          return;
        }

        const previewMessage = renames.map((r) => `${r.old} → ${r.new}`).join('\n');
        const confirm = await ui.showInfoModal(
          `Rename ${renames.length} branches?\n\n${previewMessage}`,
          'Rename All',
        );

        if (confirm === 'Rename All') {
          let successCount = 0;
          const failures: string[] = [];
          for (const rename of renames) {
            try {
              await git.rename(gitRoot, rename.old, rename.new);
              successCount++;
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              failures.push(`${rename.old}: ${msg}`);
            }
          }

          if (successCount > 0) {
            ui.showInfo(`Renamed ${successCount} branches`);
          }
          if (failures.length > 0) {
            const detail = failures.length <= 3
              ? failures.join('; ')
              : `${failures.slice(0, 3).join('; ')}; +${failures.length - 3} more`;
            ui.showWarning(`Failed to rename ${failures.length} branches: ${detail}`);
          }
          await updateWebview();
          await updateStatusBar();
        }
      } catch (error) {
        ui.showError(`Batch rename failed: ${error}`);
      }
      break;

    case 'deleteRemote':
      try {
        const remote = reqStr(m.remote, 'remote');
        const branch = requireValidRef(reqStr(m.branch, 'branch'), 'branch');
        const fullName = `${remote}/${branch}`;
        await git.deleteBranchForce(gitRoot, fullName);
        ui.showInfo(`Deleted remote branch: ${fullName}`);
        await updateWebview();
      } catch (error) {
        ui.showError(`Failed to delete remote branch: ${error}`);
      }
      break;

    case 'deleteMultipleRemotes': {
      const raw = m.branches;
      if (!Array.isArray(raw)) break;
      const remoteBranches = raw.filter((rb): rb is { remote: string; name: string } =>
        rb !== null && typeof rb === 'object' &&
        typeof (rb as Record<string, unknown>).remote === 'string' &&
        typeof (rb as Record<string, unknown>).name === 'string'
      );
      let successCount = 0;

      for (const rb of remoteBranches) {
        try {
          await git.deleteBranchForce(gitRoot, `${rb.remote}/${rb.name}`);
          successCount++;
        } catch {
          // Individual failure — continue
        }
      }

      if (successCount > 0) {
        ui.showInfo(`Deleted ${successCount} remote branches`);
        await updateWebview();
      }
      break;
    }

    case 'promptBranchNote': {
      const branchName = requireValidRef(reqStr(m.branch, 'branch'), 'branch');
      const noteText = await ui.showInputBox({
        prompt: `Add note for ${branchName}`,
        placeHolder: 'Enter a note for this branch',
      });
      if (noteText !== undefined) {
        await storage.saveBranchNote(context, gitRoot, branchName, noteText);
        await updateWebview();
      }
      break;
    }

    case 'saveNote':
    case 'saveBranchNote':
      await storage.saveBranchNote(
        context,
        gitRoot,
        reqStr(m.branchName ?? m.branch, 'branchName'),
        typeof m.note === 'string' ? m.note : '',
      );
      await updateWebview();
      break;

    case 'saveCleanupRules':
      if (!isCleanupRuleArray(m.rules)) {
        ui.showError('Invalid cleanup rules payload');
        break;
      }
      await storage.saveCleanupRules(context, gitRoot, m.rules);
      await updateWebview();
      break;

    case 'evaluateRule': {
      const r = m.rule;
      if (!r || typeof r !== 'object' || typeof (r as Record<string, unknown>).id !== 'string') {
        break;
      }
      const rule = r as CleanupRule;
      const allBranches = await git.branchInfo(gitRoot);
      const matchingBranches = storage.evaluateCleanupRule(allBranches, rule);

      post({
        command: 'ruleEvaluationResult',
        matches: matchingBranches.map((b) => b.name),
      });
      break;
    }

    case 'exportRules': {
      const exportedRules = storage.getCleanupRules(context, gitRoot);
      await env.clipboardWrite(JSON.stringify(exportedRules, null, 2));
      ui.showInfo(`Exported ${exportedRules.length} rule(s) to clipboard`);
      break;
    }

    case 'importRules': {
      const clipboardText = await env.clipboardRead();
      let parsed: unknown;
      try {
        parsed = JSON.parse(clipboardText);
      } catch {
        ui.showError('Clipboard does not contain valid JSON');
        break;
      }
      if (!Array.isArray(parsed)) {
        ui.showError('Imported JSON must be an array of rules');
        break;
      }
      const imported = (parsed as unknown[]).filter(
        (entry): entry is CleanupRule =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof (entry as Record<string, unknown>).id === 'string' &&
          typeof (entry as Record<string, unknown>).name === 'string' &&
          typeof (entry as Record<string, unknown>).enabled === 'boolean' &&
          (entry as Record<string, unknown>).conditions !== null &&
          typeof (entry as Record<string, unknown>).conditions === 'object',
      );
      if (imported.length === 0) {
        ui.showError('No valid rules found in clipboard JSON');
        break;
      }
      const existingRules = storage.getCleanupRules(context, gitRoot);
      if (existingRules.length > 0) {
        const answer = await ui.showWarningModal(
          `Replace ${existingRules.length} existing rule(s) with ${imported.length} imported?`,
          'Replace',
        );
        if (answer !== 'Replace') break;
      }
      await storage.saveCleanupRules(context, gitRoot, imported);
      await updateWebview();
      ui.showInfo(`Imported ${imported.length} rule(s)`);
      break;
    }

    case 'connectGitHub':
      try {
        const token = await hooks.getGitHubToken(false);
        if (token) {
          ui.showInfo('Connected to GitHub');
          await updateWebview();
        }
      } catch (error) {
        ui.showError(`Failed to connect to GitHub: ${error}`);
      }
      break;

    case 'createBranch':
      void hooks.createBranchFromTemplate();
      break;

    case 'createWorktree':
      void hooks.createWorktreeFromBranch();
      break;

    case 'openSupport':
      void env.openExternal('https://www.buymeacoffee.com/YonasValentin');
      break;

    case 'openSponsor':
      void env.openExternal('https://github.com/sponsors/YonasValentin');
      break;

    case 'openGithub':
      void env.openExternal('https://github.com/YonasValentin/git-branch-manager/issues');
      break;

    case 'dismissSponsor':
      await context.globalState.update('sponsorBannerDismissed', true);
      break;

    case 'openUrl':
      if (typeof m.url === 'string') {
        void env.openExternal(m.url);
      }
      break;

    case 'refresh':
      await updateWebview();
      break;

    case 'switchRepository': {
      if (hooks.getRepositoriesCount() === 0) {
        await hooks.discoverRepositories();
      }
      const selectedPath = await hooks.selectRepository();
      if (selectedPath) {
        await hooks.setActiveRepository(selectedPath);
        await updateWebview();
        await updateStatusBar();
        hooks.branchTreeRefresh();
      }
      break;
    }

    case 'restoreBranch': {
      const branchName = requireValidRef(reqStr(m.branchName, 'branchName'), 'branchName');
      const commitHash = reqStr(m.commitHash, 'commitHash');
      const result = await storage.restoreFromLog(context, gitRoot, branchName, commitHash);
      if (!result.success) {
        ui.showError(`Failed to restore: ${result.error}`);
      }
      await updateWebview();
      await updateStatusBar();
      break;
    }

    case 'clearRecoveryEntry': {
      const branchName = requireValidRef(reqStr(m.branchName, 'branchName'), 'branchName');
      const commitHash = reqStr(m.commitHash, 'commitHash');
      await storage.removeRecoveryEntry(context, gitRoot, branchName, commitHash);
      await updateWebview();
      break;
    }

    case 'openDiff':
      try {
        const branchA = requireValidRef(reqStr(m.branchA, 'branchA'), 'branchA');
        const branchB = requireValidRef(reqStr(m.branchB, 'branchB'), 'branchB');
        const filePath = reqStr(m.filePath, 'filePath');
        await hooks.openDiff(branchA, branchB, filePath, gitRoot);
      } catch (error) {
        ui.showError(`Failed to open diff: ${error}`);
      }
      break;

    case 'setTheme': {
      const theme = m.theme === 'light' ? 'light' : m.theme === 'dark' ? 'dark' : null;
      if (theme) {
        await context.workspaceState.update('theme', theme);
      }
      break;
    }
  }
}

