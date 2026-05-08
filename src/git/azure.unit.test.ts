import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { fetchAzurePRs, type RequestFn } from './azure';

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

const PR_PAGE = (prs: Array<Partial<{
  pullRequestId: number; status: string; title: string; sourceRefName: string; isDraft: boolean;
}>>) => JSON.stringify({
  count: prs.length,
  value: prs.map((p) => ({
    pullRequestId: p.pullRequestId ?? 1,
    status: p.status ?? 'active',
    title: p.title ?? 'PR',
    sourceRefName: p.sourceRefName ?? 'refs/heads/feat/x',
    isDraft: p.isDraft ?? false,
  })),
});

describe('fetchAzurePRs — auth headers', () => {
  test('uses Basic auth with empty username and PAT password', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_PAGE([{}]) }]);
    await fetchAzurePRs('org', 'proj', 'repo', ['feat/x'], 'pat-secret', request);
    const auth = calls[0]!.options.headers!['Authorization'] as string;
    expect(auth.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    expect(decoded).toBe(':pat-secret');
  });

  test('hostname is dev.azure.com', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_PAGE([]) }]);
    await fetchAzurePRs('org', 'proj', 'repo', [], 'pat', request);
    expect(calls[0]!.options.hostname).toBe('dev.azure.com');
  });

  test('encodes organization, project, and repo in URL', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_PAGE([]) }]);
    await fetchAzurePRs('my org', 'my proj', 'my repo', [], 'pat', request);
    const path = calls[0]!.options.path as string;
    expect(path).toContain('my%20org');
    expect(path).toContain('my%20proj');
    expect(path).toContain('my%20repo');
  });
});

describe('fetchAzurePRs — pagination via $skip', () => {
  test('first page uses $skip=0', async () => {
    const { request, calls } = makeFake([{ status: 200, body: PR_PAGE([]) }]);
    await fetchAzurePRs('o', 'p', 'r', [], 'pat', request);
    expect((calls[0]!.options.path as string)).toContain('$skip=0');
  });

  test('continues paging while page is full', async () => {
    const fullPage = PR_PAGE(Array.from({ length: 100 }, (_, i) => ({
      pullRequestId: i,
      sourceRefName: `refs/heads/feat/${i}`,
    })));
    const { request, calls } = makeFake([
      { status: 200, body: fullPage },
      { status: 200, body: PR_PAGE([{ pullRequestId: 999, sourceRefName: 'refs/heads/feat/999' }]) },
    ]);
    await fetchAzurePRs('o', 'p', 'r', [], 'pat', request);
    expect(calls).toHaveLength(2);
    expect((calls[1]!.options.path as string)).toContain('$skip=100');
  });

  test('stops when page is short', async () => {
    const { request, calls } = makeFake([
      { status: 200, body: PR_PAGE([{ pullRequestId: 1 }]) },
    ]);
    await fetchAzurePRs('o', 'p', 'r', [], 'pat', request);
    expect(calls).toHaveLength(1);
  });

  test('caps at 10 pages of full pages', async () => {
    const fullPage = PR_PAGE(Array.from({ length: 100 }, (_, i) => ({
      pullRequestId: i,
      sourceRefName: `refs/heads/feat/${i}`,
    })));
    const responses: FakeResponse[] = Array.from({ length: 12 }, () => ({ status: 200, body: fullPage }));
    const { request, calls } = makeFake(responses);
    await fetchAzurePRs('o', 'p', 'r', [], 'pat', request);
    expect(calls.length).toBeLessThanOrEqual(10);
  });
});

describe('fetchAzurePRs — error surfacing', () => {
  test('rejects on 401', async () => {
    const { request } = makeFake([{ status: 401, body: '' }]);
    await expect(fetchAzurePRs('o', 'p', 'r', [], 'pat', request))
      .rejects.toThrow(/not authenticated/i);
  });

  test('rejects on 403', async () => {
    const { request } = makeFake([{ status: 403, body: '' }]);
    await expect(fetchAzurePRs('o', 'p', 'r', [], 'pat', request))
      .rejects.toThrow(/forbidden/i);
  });

  test('rejects on 429', async () => {
    const { request } = makeFake([{ status: 429, body: '' }]);
    await expect(fetchAzurePRs('o', 'p', 'r', [], 'pat', request))
      .rejects.toThrow(/rate limit/i);
  });
});

describe('fetchAzurePRs — state mapping', () => {
  test('active + isDraft → draft', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_PAGE([{ status: 'active', isDraft: true }]),
    }]);
    const result = await fetchAzurePRs('o', 'p', 'r', ['feat/x'], 'pat', request);
    expect(result.get('feat/x')!.state).toBe('draft');
  });

  test('active → open', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_PAGE([{ status: 'active' }]),
    }]);
    const result = await fetchAzurePRs('o', 'p', 'r', ['feat/x'], 'pat', request);
    expect(result.get('feat/x')!.state).toBe('open');
  });

  test('completed → merged', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_PAGE([{ status: 'completed' }]),
    }]);
    const result = await fetchAzurePRs('o', 'p', 'r', ['feat/x'], 'pat', request);
    expect(result.get('feat/x')!.state).toBe('merged');
  });

  test('abandoned → closed', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_PAGE([{ status: 'abandoned' }]),
    }]);
    const result = await fetchAzurePRs('o', 'p', 'r', ['feat/x'], 'pat', request);
    expect(result.get('feat/x')!.state).toBe('closed');
  });
});

describe('fetchAzurePRs — sourceRefName parsing', () => {
  test('strips refs/heads/ prefix', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_PAGE([{ sourceRefName: 'refs/heads/feat/foo' }]),
    }]);
    const result = await fetchAzurePRs('o', 'p', 'r', ['feat/foo'], 'pat', request);
    expect(result.get('feat/foo')).toBeDefined();
  });

  test('builds web URL with PR id', async () => {
    const { request } = makeFake([{
      status: 200,
      body: PR_PAGE([{ pullRequestId: 42, sourceRefName: 'refs/heads/feat/x' }]),
    }]);
    const result = await fetchAzurePRs('myorg', 'myproj', 'myrepo', ['feat/x'], 'pat', request);
    expect(result.get('feat/x')!.url).toContain('/_git/myrepo/pullrequest/42');
  });
});
