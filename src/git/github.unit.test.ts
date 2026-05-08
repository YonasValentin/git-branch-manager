import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { fetchGitHubPRs, type RequestFn } from './github';

interface FakeResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

interface RequestRecord {
  options: https.RequestOptions;
}

function makeFake(responses: FakeResponse[]): { request: RequestFn; calls: RequestRecord[] } {
  const calls: RequestRecord[] = [];
  let idx = 0;
  const request: RequestFn = ((options: https.RequestOptions, cb: (res: http.IncomingMessage) => void) => {
    calls.push({ options });
    const r = responses[idx++] ?? responses[responses.length - 1]!;
    const res = new EventEmitter() as http.IncomingMessage;
    res.statusCode = r.status;
    res.headers = r.headers ?? {};
    (res as unknown as { destroy: () => void }).destroy = vi.fn();

    const req = new EventEmitter() as http.ClientRequest;
    (req as unknown as { setTimeout: (...a: unknown[]) => void }).setTimeout = vi.fn();
    (req as unknown as { destroy: (...a: unknown[]) => void }).destroy = vi.fn();
    (req as unknown as { end: () => void }).end = vi.fn(() => {
      setImmediate(() => {
        cb(res);
        setImmediate(() => {
          res.emit('data', Buffer.from(r.body));
          res.emit('end');
        });
      });
    });
    return req;
  }) as RequestFn;
  return { request, calls };
}

const PR_BODY = (overrides: Partial<{
  number: number; state: string; title: string; html_url: string;
  draft: boolean; merged_at: string | null; ref: string;
}> = {}) => JSON.stringify([{
  number: overrides.number ?? 1,
  state: overrides.state ?? 'open',
  title: overrides.title ?? 'PR title',
  html_url: overrides.html_url ?? 'https://github.com/o/r/pull/1',
  draft: overrides.draft ?? false,
  merged_at: overrides.merged_at ?? null,
  head: { ref: overrides.ref ?? 'feat/x' },
}]);

describe('fetchGitHubPRs — auth headers', () => {
  test('uses Bearer auth when token provided', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_BODY() }]);
    await fetchGitHubPRs('o', 'r', ['feat/x'], 'tok123', request);
    expect(calls[0]!.options.headers!['Authorization']).toBe('Bearer tok123');
  });

  test('omits Authorization header when no token', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_BODY() }]);
    await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(calls[0]!.options.headers!['Authorization']).toBeUndefined();
  });

  test('sends X-GitHub-Api-Version: 2022-11-28', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_BODY() }]);
    await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(calls[0]!.options.headers!['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  test('sends Accept: application/vnd.github+json', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_BODY() }]);
    await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(calls[0]!.options.headers!['Accept']).toBe('application/vnd.github+json');
  });

  test('sends User-Agent', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_BODY() }]);
    await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(calls[0]!.options.headers!['User-Agent']).toBe('git-branch-manager-vscode');
  });
});

describe('fetchGitHubPRs — URL construction', () => {
  test('encodes owner and repo in URL path', async () => {
    const { request, calls } = makeFake([{ status: 200, body: '[]' }]);
    await fetchGitHubPRs('owner with space', 'repo/odd', [], undefined, request);
    const path = calls[0]!.options.path as string;
    expect(path).toContain('owner%20with%20space');
    expect(path).toContain('repo%2Fodd');
  });

  test('asks for state=all and per_page=100', async () => {
    const { request, calls } = makeFake([{ status: 200, body: '[]' }]);
    await fetchGitHubPRs('o', 'r', [], undefined, request);
    expect(calls[0]!.options.path).toContain('state=all');
    expect(calls[0]!.options.path).toContain('per_page=100');
  });
});

describe('fetchGitHubPRs — pagination via Link header', () => {
  test('follows next link', async () => {
    const { request, calls } = makeFake([
      {
        status: 200,
        headers: { link: '<https://api.github.com/repositories/1/pulls?page=2&per_page=100>; rel="next"' },
        body: PR_BODY({ number: 1, ref: 'feat/a' }),
      },
      { status: 200, body: PR_BODY({ number: 2, ref: 'feat/b' }) },
    ]);
    const result = await fetchGitHubPRs('o', 'r', ['feat/a', 'feat/b'], undefined, request);
    expect(calls).toHaveLength(2);
    expect(result.size).toBe(2);
  });

  test('caps at 10 pages even if next link keeps appearing', async () => {
    const responses: FakeResponse[] = Array.from({ length: 12 }, (_, i) => ({
      status: 200,
      headers: { link: `<https://api.github.com/repositories/1/pulls?page=${i + 2}>; rel="next"` },
      body: '[]',
    }));
    const { request, calls } = makeFake(responses);
    await fetchGitHubPRs('o', 'r', [], undefined, request);
    expect(calls.length).toBeLessThanOrEqual(10);
  });

  test('stops when no next link', async () => {
    const { request, calls } = makeFake([
      { status: 200, body: PR_BODY() },
    ]);
    await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(calls).toHaveLength(1);
  });
});

describe('fetchGitHubPRs — error surfacing', () => {
  test('rejects with auth error on 401', async () => {
    const { request } = makeFake([{ status: 401, body: '' }]);
    await expect(fetchGitHubPRs('o', 'r', [], undefined, request))
      .rejects.toThrow(/not authenticated/i);
  });

  test('rejects with rate-limit error on 403 + x-ratelimit-remaining=0', async () => {
    const { request } = makeFake([{
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      body: '',
    }]);
    await expect(fetchGitHubPRs('o', 'r', [], undefined, request))
      .rejects.toThrow(/rate limit/i);
  });

  test('rejects with forbidden on 403 without rate-limit header', async () => {
    const { request } = makeFake([{ status: 403, body: '' }]);
    await expect(fetchGitHubPRs('o', 'r', [], undefined, request))
      .rejects.toThrow(/forbidden/i);
  });

  test('rejects with not-found on 404', async () => {
    const { request } = makeFake([{ status: 404, body: '' }]);
    await expect(fetchGitHubPRs('o', 'r', [], undefined, request))
      .rejects.toThrow(/not found/i);
  });

  test('rejects with HTTP code on 500', async () => {
    const { request } = makeFake([{ status: 500, body: '' }]);
    await expect(fetchGitHubPRs('o', 'r', [], undefined, request))
      .rejects.toThrow(/HTTP 500/);
  });
});

describe('fetchGitHubPRs — response parsing', () => {
  test('only returns PRs whose head.ref matches branches input', async () => {
    const body = JSON.stringify([
      { number: 1, state: 'open', title: 'A', html_url: 'u', head: { ref: 'feat/a' } },
      { number: 2, state: 'open', title: 'B', html_url: 'u', head: { ref: 'feat/b' } },
    ]);
    const { request } = makeFake([{ status: 200, body }]);
    const result = await fetchGitHubPRs('o', 'r', ['feat/a'], undefined, request);
    expect(result.size).toBe(1);
    expect(result.get('feat/a')).toBeDefined();
    expect(result.get('feat/b')).toBeUndefined();
  });

  test('maps merged_at to state=merged', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_BODY({ state: 'closed', merged_at: '2025-01-01T00:00:00Z' }),
    }]);
    const result = await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(result.get('feat/x')!.state).toBe('merged');
  });

  test('maps draft=true to state=draft', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_BODY({ state: 'open', draft: true }),
    }]);
    const result = await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(result.get('feat/x')!.state).toBe('draft');
  });

  test('maps state=closed to closed', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_BODY({ state: 'closed' }),
    }]);
    const result = await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(result.get('feat/x')!.state).toBe('closed');
  });

  test('preserves PR title and url', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_BODY({ title: 'Add foo', html_url: 'https://github.com/o/r/pull/42' }),
    }]);
    const result = await fetchGitHubPRs('o', 'r', ['feat/x'], undefined, request);
    expect(result.get('feat/x')!.title).toBe('Add foo');
    expect(result.get('feat/x')!.url).toBe('https://github.com/o/r/pull/42');
  });

  test('rejects when body is not JSON', async () => {
    const { request } = makeFake([{ status: 200, body: 'not json' }]);
    await expect(fetchGitHubPRs('o', 'r', [], undefined, request)).rejects.toThrow();
  });
});
