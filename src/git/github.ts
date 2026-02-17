import * as https from 'https';
import { gitCommand } from './core';
import { PRStatus } from '../types';

/**
 * Gets GitHub remote info from git config.
 * @param cwd - Working directory
 * @returns GitHub owner and repo, or null
 */
export async function getGitHubInfo(cwd: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const url = await gitCommand(['remote', 'get-url', 'origin'], cwd);
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  } catch {}
  return null;
}

/**
 * Fetches PR status for branches from GitHub API.
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branches - Branch names to check
 * @param token - GitHub token (optional)
 * @returns Map of branch name to PR status
 */
export async function fetchGitHubPRs(
  owner: string,
  repo: string,
  branches: string[],
  token?: string
): Promise<Map<string, PRStatus>> {
  const result = new Map<string, PRStatus>();
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/pulls?state=all&per_page=100`,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'git-branch-manager-vscode',
        ...(token ? { 'Authorization': `token ${token}` } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve(result);
            return;
          }
          const prs = JSON.parse(data) as any[];
          for (const pr of prs) {
            const branchName = pr.head?.ref;
            if (branchName && branches.includes(branchName)) {
              result.set(branchName, {
                number: pr.number,
                state: pr.merged_at ? 'merged' : pr.draft ? 'draft' : pr.state,
                title: pr.title,
                url: pr.html_url,
              });
            }
          }
          resolve(result);
        } catch {
          resolve(result);
        }
      });
    });

    req.on('error', () => { resolve(result); });
    req.end();
  });
}
