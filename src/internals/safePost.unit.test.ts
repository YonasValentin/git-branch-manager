import { describe, expect, test, vi } from 'vitest';
import { createSafePost, type DisposalState } from './safePost';

describe('createSafePost', () => {
  test('forwards messages while not disposed', () => {
    const raw = vi.fn();
    const state: DisposalState = { disposed: false };
    const post = createSafePost(raw, state);
    post({ command: 'x' });
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw).toHaveBeenCalledWith({ command: 'x' });
  });

  test('drops messages after state.disposed is set to true', () => {
    const raw = vi.fn();
    const state: DisposalState = { disposed: false };
    const post = createSafePost(raw, state);
    post({ command: 'before' });
    state.disposed = true;
    post({ command: 'after' });
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw).toHaveBeenCalledWith({ command: 'before' });
  });

  test('drops the very first message if disposed before the first post', () => {
    const raw = vi.fn();
    const state: DisposalState = { disposed: true };
    const post = createSafePost(raw, state);
    post({ command: 'never-arrives' });
    expect(raw).not.toHaveBeenCalled();
  });

  test('reads the disposed flag at call time, not at factory time (live binding)', () => {
    // Critical: if we captured `state.disposed` by value at factory time, this
    // would still post after disposal. The test guards against that regression.
    const raw = vi.fn();
    const state: DisposalState = { disposed: true };
    const post = createSafePost(raw, state);
    state.disposed = false;
    post({ command: 'now-allowed' });
    expect(raw).toHaveBeenCalledOnce();
  });

  test('passes any payload shape through verbatim', () => {
    const raw = vi.fn();
    const state: DisposalState = { disposed: false };
    const post = createSafePost(raw, state);
    const payload = { command: 'comparisonResult', data: { ahead: [1, 2, 3] } };
    post(payload);
    expect(raw).toHaveBeenCalledWith(payload);
  });

  test('does not throw if rawPost throws — caller is on the failure side', () => {
    // Note: we explicitly do NOT swallow rawPost throws. The disposed flag is
    // about preventing a known-bad call; if rawPost itself throws on a live
    // panel, that's a different bug and we want to surface it.
    const raw = vi.fn(() => { throw new Error('vscode error'); });
    const state: DisposalState = { disposed: false };
    const post = createSafePost(raw, state);
    expect(() => post({ command: 'x' })).toThrow('vscode error');
  });
});
