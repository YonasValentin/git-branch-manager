import * as https from 'https';
import { PRStatus } from '../types';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_BODY = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

interface AzurePR {
  pullRequestId: number;
  status: string;
  title: string;
  sourceRefName: string;
  isDraft?: boolean;
}

interface PageResult {
  prs: AzurePR[];
  count: number;
}

/**
 * Azure DevOps does not use Link headers for pagination — instead it uses
 * `$top` + `$skip` query params and returns `count` per page. We page until
 * fewer than PAGE_SIZE results come back or we hit MAX_PAGES.
 */
function fetchPage(
  organization: string,
  project: string,
  repo: string,
  pat: string,
  skip: number,
): Promise<PageResult> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`:${pat}`).toString('base64');
    const options: https.RequestOptions = {
      hostname: 'dev.azure.com',
      path: `/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.status=all&$top=${PAGE_SIZE}&$skip=${skip}&api-version=7.1`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'git-branch-manager-vscode',
        'Authorization': `Basic ${auth}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      let aborted = false;
      res.on('data', (chunk) => {
        if (aborted) return;
        if (data.length + chunk.length > MAX_BODY) {
          aborted = true;
          res.destroy();
          reject(new Error('Azure DevOps response exceeded 5 MB cap'));
          return;
        }
        data += chunk;
      });
      res.on('error', (err) => { if (!aborted) reject(err); });
      res.on('end', () => {
        if (aborted) return;
        const status = res.statusCode ?? 0;
        if (status === 401) return reject(new Error('Azure DevOps: not authenticated (401)'));
        if (status === 403) return reject(new Error('Azure DevOps: forbidden (403)'));
        if (status === 404) return reject(new Error(`Azure DevOps: ${options.path} not found (404)`));
        if (status === 429) return reject(new Error('Azure DevOps: rate limit exceeded (429)'));
        if (status < 200 || status >= 300) return reject(new Error(`Azure DevOps HTTP ${status}`));
        try {
          const body = JSON.parse(data) as { value?: AzurePR[]; count?: number };
          const prs = body.value ?? [];
          resolve({ prs, count: body.count ?? prs.length });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Azure DevOps: request timed out after 10s'));
    });
    req.end();
  });
}

/**
 * Fetches pull request status for branches from Azure DevOps REST v7.1.
 *
 * - Uses Basic auth with empty username and PAT as password (Azure quirk).
 * - Strips `refs/heads/` from `sourceRefName`.
 * - State mapping: active+isDraft → draft, active → open, completed → merged, abandoned → closed.
 * - Pages via `$skip` until short page received or MAX_PAGES reached.
 * - Throws on non-2xx so the caller can surface the failure.
 */
export async function fetchAzurePRs(
  organization: string,
  project: string,
  repo: string,
  branches: string[],
  pat: string,
): Promise<Map<string, PRStatus>> {
  const result = new Map<string, PRStatus>();
  const branchSet = new Set(branches);

  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = page * PAGE_SIZE;
    const { prs }: PageResult = await fetchPage(organization, project, repo, pat, skip);
    for (const pr of prs) {
      const branchName = pr.sourceRefName.replace(/^refs\/heads\//, '');
      if (branchName && branchSet.has(branchName)) {
        const state: PRStatus['state'] =
          pr.status === 'active' && pr.isDraft ? 'draft' :
          pr.status === 'active' ? 'open' :
          pr.status === 'completed' ? 'merged' :
          'closed';
        const webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.pullRequestId}`;
        result.set(branchName, {
          number: pr.pullRequestId,
          state,
          title: pr.title,
          url: webUrl,
        });
      }
    }
    if (prs.length < PAGE_SIZE) break;
  }
  return result;
}
