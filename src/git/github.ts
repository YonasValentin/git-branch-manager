import * as https from 'https';
import { gitCommand } from './core';
import { PRStatus } from '../types';
import { parseLinkHeader } from '../internals/parseLinkHeader';

export async function getGitHubInfo(cwd: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const url = await gitCommand(['remote', 'get-url', 'origin'], cwd);
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match && match[1] && match[2]) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  } catch {}
  return null;
}

const MAX_PAGES = 10; // 10 × 100 = 1000 PRs cap (defense against runaway pagination)
const MAX_BODY = 5 * 1024 * 1024; // 5 MB
const REQUEST_TIMEOUT_MS = 10_000;

interface GitHubPR {
  number: number;
  state: string;
  title: string;
  html_url: string;
  draft?: boolean;
  merged_at?: string;
  head?: { ref?: string };
}

interface PageResult {
  prs: GitHubPR[];
  nextUrl?: string;
}

// Throws on non-2xx so the caller can show an error toast instead of
// silently degrading to "no PRs".
function fetchPage(url: URL, token: string | undefined): Promise<PageResult> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'git-branch-manager-vscode',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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
          reject(new Error('GitHub response exceeded 5 MB cap'));
          return;
        }
        data += chunk;
      });
      res.on('error', (err) => {
        if (!aborted) reject(err);
      });
      res.on('end', () => {
        if (aborted) return;
        const status = res.statusCode ?? 0;
        if (status === 401) return reject(new Error('GitHub: not authenticated (401)'));
        if (status === 403) {
          const remaining = res.headers['x-ratelimit-remaining'];
          if (remaining === '0') return reject(new Error('GitHub: rate limit exceeded (403)'));
          return reject(new Error('GitHub: forbidden (403)'));
        }
        if (status === 404) return reject(new Error(`GitHub: ${url.pathname} not found (404)`));
        if (status < 200 || status >= 300) return reject(new Error(`GitHub HTTP ${status}`));
        try {
          const prs = JSON.parse(data) as GitHubPR[];
          const link = parseLinkHeader(res.headers.link as string | undefined);
          resolve({ prs, nextUrl: link.next });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('GitHub: request timed out after 10s'));
    });
    req.end();
  });
}

/**
 * Fetches PR status for branches from GitHub API. Follows pagination up to
 * MAX_PAGES pages. Throws on auth/rate-limit/network failures so the caller
 * can surface them.
 */
export async function fetchGitHubPRs(
  owner: string,
  repo: string,
  branches: string[],
  token?: string,
): Promise<Map<string, PRStatus>> {
  const result = new Map<string, PRStatus>();
  const branchSet = new Set(branches);

  let url: URL | undefined = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&per_page=100`
  );

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const { prs, nextUrl }: PageResult = await fetchPage(url, token);
    for (const pr of prs) {
      const branchName = pr.head?.ref;
      if (branchName && branchSet.has(branchName)) {
        result.set(branchName, {
          number: pr.number,
          state: pr.merged_at ? 'merged' : pr.draft ? 'draft' : (pr.state === 'closed' ? 'closed' : 'open'),
          title: pr.title,
          url: pr.html_url,
        });
      }
    }
    url = nextUrl ? new URL(nextUrl) : undefined;
  }
  return result;
}
