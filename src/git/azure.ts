import * as https from 'https';
import { PRStatus } from '../types';

/**
 * Fetches pull request status for branches from the Azure DevOps REST API v7.1.
 *
 * Uses Basic authentication with empty username and PAT as password.
 * Strips refs/heads/ prefix from sourceRefName before branch lookup.
 * State mapping: active+isDraft → draft, active → open, completed → merged, abandoned → closed.
 *
 * @param organization - Azure DevOps organization name
 * @param project - Azure DevOps project name
 * @param repo - Azure DevOps repository name
 * @param branches - Branch names to check
 * @param pat - Azure DevOps personal access token
 * @returns Map of branch name to PR status; resolves with empty map on error
 */
export async function fetchAzurePRs(
  organization: string,
  project: string,
  repo: string,
  branches: string[],
  pat: string
): Promise<Map<string, PRStatus>> {
  const result = new Map<string, PRStatus>();
  return new Promise((resolve) => {
    const auth = Buffer.from(`:${pat}`).toString('base64');
    const options: https.RequestOptions = {
      hostname: 'dev.azure.com',
      path: `/${organization}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.status=all&$top=100&api-version=7.1`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'git-branch-manager-vscode',
        'Authorization': `Basic ${auth}`,
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
          const body = JSON.parse(data) as { value: any[] };
          for (const pr of body.value) {
            // Strip refs/heads/ prefix from sourceRefName
            const branchName = (pr.sourceRefName as string).replace(/^refs\/heads\//, '');
            if (branchName && branches.includes(branchName)) {
              const rawState: string = pr.status;
              let state: PRStatus['state'];
              if (rawState === 'active' && pr.isDraft) {
                state = 'draft';
              } else if (rawState === 'active') {
                state = 'open';
              } else if (rawState === 'completed') {
                state = 'merged';
              } else {
                // abandoned
                state = 'closed';
              }
              const webUrl = `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.pullRequestId}`;
              result.set(branchName, {
                number: pr.pullRequestId,
                state,
                title: pr.title,
                url: webUrl,
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
