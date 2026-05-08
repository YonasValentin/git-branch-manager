import * as https from 'https';
import { PRStatus } from '../types';
import { parseLinkHeader } from '../internals/parseLinkHeader';

const MAX_PAGES = 10;
const MAX_BODY = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

interface GitLabMR {
  iid: number;
  state: string;
  title: string;
  web_url: string;
  source_branch: string;
}

interface PageResult {
  mrs: GitLabMR[];
  nextUrl?: string;
}

function fetchPage(url: URL, token: string): Promise<PageResult> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'git-branch-manager-vscode',
        'PRIVATE-TOKEN': token,
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
          reject(new Error('GitLab response exceeded 5 MB cap'));
          return;
        }
        data += chunk;
      });
      res.on('error', (err) => { if (!aborted) reject(err); });
      res.on('end', () => {
        if (aborted) return;
        const status = res.statusCode ?? 0;
        if (status === 401) return reject(new Error('GitLab: not authenticated (401)'));
        if (status === 403) return reject(new Error('GitLab: forbidden (403)'));
        if (status === 404) return reject(new Error(`GitLab: ${url.pathname} not found (404)`));
        if (status === 429) return reject(new Error('GitLab: rate limit exceeded (429)'));
        if (status < 200 || status >= 300) return reject(new Error(`GitLab HTTP ${status}`));
        try {
          const mrs = JSON.parse(data) as GitLabMR[];
          const link = parseLinkHeader(res.headers.link as string | undefined);
          resolve({ mrs, nextUrl: link.next });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('GitLab: request timed out after 10s'));
    });
    req.end();
  });
}

/**
 * Fetches merge request status for branches from the GitLab API v4.
 *
 * Uses PRIVATE-TOKEN authentication.
 * State mapping: opened → open, merged → merged, closed/locked → closed.
 * Follows pagination via Link header up to MAX_PAGES.
 * Throws on non-2xx so the caller can show an error toast.
 */
export async function fetchGitLabMRs(
  host: string,
  projectPath: string,
  branches: string[],
  token: string,
): Promise<Map<string, PRStatus>> {
  const result = new Map<string, PRStatus>();
  const branchSet = new Set(branches);

  let url: URL | undefined = new URL(
    `https://${host}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests?state=all&per_page=100`
  );

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const { mrs, nextUrl }: PageResult = await fetchPage(url, token);
    for (const mr of mrs) {
      const branchName = mr.source_branch;
      if (branchName && branchSet.has(branchName)) {
        const rawState = mr.state;
        const state: PRStatus['state'] =
          rawState === 'opened' ? 'open' :
          rawState === 'merged' ? 'merged' :
          'closed';
        result.set(branchName, {
          number: mr.iid,
          state,
          title: mr.title,
          url: mr.web_url,
        });
      }
    }
    url = nextUrl ? new URL(nextUrl) : undefined;
  }
  return result;
}
