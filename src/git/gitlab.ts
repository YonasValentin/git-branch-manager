import * as https from 'https';
import { PRStatus } from '../types';

/**
 * Fetches merge request status for branches from the GitLab API v4.
 *
 * Uses PRIVATE-TOKEN authentication (not Bearer).
 * State mapping: opened → open, merged → merged, closed/locked → closed.
 *
 * @param host - GitLab host (e.g. "gitlab.com" or "gitlab.example.com")
 * @param projectPath - URL-encoded project path (e.g. "namespace/project")
 * @param branches - Branch names to check
 * @param token - GitLab personal access token
 * @returns Map of branch name to PR status; resolves with empty map on error
 */
export async function fetchGitLabMRs(
  host: string,
  projectPath: string,
  branches: string[],
  token: string
): Promise<Map<string, PRStatus>> {
  const result = new Map<string, PRStatus>();
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: host,
      path: `/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests?state=all&per_page=100`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'git-branch-manager-vscode',
        'PRIVATE-TOKEN': token,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      const MAX_BODY = 5 * 1024 * 1024; // 5 MB cap
      res.on('data', (chunk) => {
        if (data.length + chunk.length > MAX_BODY) { res.destroy(); resolve(result); return; }
        data += chunk;
      });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve(result);
            return;
          }
          const mrs = JSON.parse(data) as Array<{
            iid: number; state: string; title: string; web_url: string; source_branch: string;
          }>;
          for (const mr of mrs) {
            const branchName = mr.source_branch;
            if (branchName && branches.includes(branchName)) {
              const rawState: string = mr.state;
              let state: PRStatus['state'];
              if (rawState === 'opened') {
                state = 'open';
              } else if (rawState === 'merged') {
                state = 'merged';
              } else {
                // closed, locked
                state = 'closed';
              }
              result.set(branchName, {
                number: mr.iid,
                state,
                title: mr.title,
                url: mr.web_url,
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
    req.setTimeout(10000, () => { req.destroy(); resolve(result); });
    req.end();
  });
}
