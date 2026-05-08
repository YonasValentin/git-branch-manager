import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { fetchGitLabMRs, type RequestFn } from './gitlab';

interface FakeResponse { status: number; headers?: Record<string, string>; body: string; }
interface RequestRecord { options: https.RequestOptions; }

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

const MR_BODY = (overrides: Partial<{
  iid: number; state: string; title: string; web_url: string; source_branch: string;
}> = {}) => JSON.stringify([{
  iid: overrides.iid ?? 1,
  state: overrides.state ?? 'opened',
  title: overrides.title ?? 'MR title',
  web_url: overrides.web_url ?? 'https://gitlab.com/group/proj/-/merge_requests/1',
  source_branch: overrides.source_branch ?? 'feat/x',
}]);

describe('fetchGitLabMRs — auth + headers', () => {
  test('uses PRIVATE-TOKEN header', async () => {
    const { request, calls } = makeFake([{ status: 200, body: MR_BODY() }]);
    await fetchGitLabMRs('gitlab.com', 'group/proj', ['feat/x'], 'glpat-abc', request);
    expect(calls[0]!.options.headers!['PRIVATE-TOKEN']).toBe('glpat-abc');
  });

  test('sends Accept and User-Agent', async () => {
    const { request, calls } = makeFake([{ status: 200, body: MR_BODY() }]);
    await fetchGitLabMRs('gitlab.com', 'group/proj', [], 't', request);
    expect(calls[0]!.options.headers!['Accept']).toBe('application/json');
    expect(calls[0]!.options.headers!['User-Agent']).toBe('git-branch-manager-vscode');
  });

  test('encodes project path', async () => {
    const { request, calls } = makeFake([{ status: 200, body: '[]' }]);
    await fetchGitLabMRs('gitlab.com', 'my-group/sub/proj', [], 't', request);
    expect((calls[0]!.options.path as string)).toContain('my-group%2Fsub%2Fproj');
  });
});

describe('fetchGitLabMRs — pagination', () => {
  test('follows next link', async () => {
    const { request, calls } = makeFake([
      {
        status: 200,
        headers: { link: '<https://gitlab.com/api/v4/projects/x/merge_requests?page=2>; rel="next"' },
        body: MR_BODY({ iid: 1, source_branch: 'feat/a' }),
      },
      { status: 200, body: MR_BODY({ iid: 2, source_branch: 'feat/b' }) },
    ]);
    const result = await fetchGitLabMRs('gitlab.com', 'p', ['feat/a', 'feat/b'], 't', request);
    expect(calls).toHaveLength(2);
    expect(result.size).toBe(2);
  });

  test('caps at 10 pages', async () => {
    const responses: FakeResponse[] = Array.from({ length: 12 }, (_, i) => ({
      status: 200,
      headers: { link: `<https://gitlab.com/api/v4/projects/x/merge_requests?page=${i + 2}>; rel="next"` },
      body: '[]',
    }));
    const { request, calls } = makeFake(responses);
    await fetchGitLabMRs('gitlab.com', 'p', [], 't', request);
    expect(calls.length).toBeLessThanOrEqual(10);
  });
});

describe('fetchGitLabMRs — error surfacing', () => {
  test('rejects on 401', async () => {
    const { request } = makeFake([{ status: 401, body: '' }]);
    await expect(fetchGitLabMRs('gitlab.com', 'p', [], 't', request))
      .rejects.toThrow(/not authenticated/i);
  });

  test('rejects on 403', async () => {
    const { request } = makeFake([{ status: 403, body: '' }]);
    await expect(fetchGitLabMRs('gitlab.com', 'p', [], 't', request))
      .rejects.toThrow(/forbidden/i);
  });

  test('rejects on 404', async () => {
    const { request } = makeFake([{ status: 404, body: '' }]);
    await expect(fetchGitLabMRs('gitlab.com', 'p', [], 't', request))
      .rejects.toThrow(/not found/i);
  });

  test('rejects on 429 with rate-limit message', async () => {
    const { request } = makeFake([{ status: 429, body: '' }]);
    await expect(fetchGitLabMRs('gitlab.com', 'p', [], 't', request))
      .rejects.toThrow(/rate limit/i);
  });
});

describe('fetchGitLabMRs — state mapping', () => {
  test('opened → open', async () => {
    const { request } = makeFake([{ status: 200, body: MR_BODY({ state: 'opened' }) }]);
    const result = await fetchGitLabMRs('gitlab.com', 'p', ['feat/x'], 't', request);
    expect(result.get('feat/x')!.state).toBe('open');
  });

  test('merged → merged', async () => {
    const { request } = makeFake([{ status: 200, body: MR_BODY({ state: 'merged' }) }]);
    const result = await fetchGitLabMRs('gitlab.com', 'p', ['feat/x'], 't', request);
    expect(result.get('feat/x')!.state).toBe('merged');
  });

  test('closed/locked → closed', async () => {
    const { request } = makeFake([{ status: 200, body: MR_BODY({ state: 'closed' }) }]);
    const result = await fetchGitLabMRs('gitlab.com', 'p', ['feat/x'], 't', request);
    expect(result.get('feat/x')!.state).toBe('closed');
  });
});

describe('fetchGitLabMRs — branch filtering', () => {
  test('only returns MRs whose source_branch is in input', async () => {
    const body = JSON.stringify([
      { iid: 1, state: 'opened', title: 'A', web_url: 'u', source_branch: 'feat/a' },
      { iid: 2, state: 'opened', title: 'B', web_url: 'u', source_branch: 'feat/b' },
    ]);
    const { request } = makeFake([{ status: 200, body }]);
    const result = await fetchGitLabMRs('gitlab.com', 'p', ['feat/a'], 't', request);
    expect(result.size).toBe(1);
    expect(result.get('feat/a')).toBeDefined();
  });
});
