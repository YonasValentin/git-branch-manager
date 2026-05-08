import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('../bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { RemoteView } from './remote';
import type { RepoRemote, RepoInfo } from '../types';

const remote = (over: Partial<RepoRemote> = {}): RepoRemote => ({
  name: 'origin/feat/x',
  daysOld: 5,
  isMerged: false,
  isGone: false,
  author: 'A',
  localBranch: null,
  ahead: 0,
  behind: 0,
  ...over,
});

const repo: RepoInfo = {
  name: 'demo',
  path: '/demo',
  currentBranch: 'main',
  remote: 'origin',
  remoteUrl: 'github.com/demo/demo',
  defaultBranch: 'main',
  protectedBranches: [],
  staleDays: 30,
};

beforeEach(() => sendMessageMock.mockReset());

describe('RemoteView filter chips', () => {
  test('renders the "Gone" chip alongside All / Merged / Stale (matches design)', () => {
    render(
      <RemoteView
        remoteBranches={[
          remote({ name: 'origin/keep', isGone: false }),
          remote({ name: 'origin/orphan', isGone: true }),
        ]}
        repo={repo}
        authors={{}}
        onAddToast={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^All/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Merged/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Stale/ })).toBeDefined();
    // The actual addition under test:
    expect(screen.getByRole('button', { name: /^Gone/ })).toBeDefined();
  });

  test('Gone chip filters down to remoteGone branches only', () => {
    render(
      <RemoteView
        remoteBranches={[
          remote({ name: 'origin/keep', isGone: false }),
          remote({ name: 'origin/orphan', isGone: true }),
        ]}
        repo={repo}
        authors={{}}
        onAddToast={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Gone/ }));
    expect(screen.queryByText('origin/orphan')).not.toBeNull();
    expect(screen.queryByText('origin/keep')).toBeNull();
  });

  test('Gone chip count reflects isGone branches', () => {
    render(
      <RemoteView
        remoteBranches={[
          remote({ name: 'a', isGone: true }),
          remote({ name: 'b', isGone: true }),
          remote({ name: 'c', isGone: false }),
        ]}
        repo={repo}
        authors={{}}
        onAddToast={vi.fn()}
      />,
    );
    // The chip's label includes its count — search for "Gone 2" pattern
    expect(screen.getByRole('button', { name: /Gone\s*2/ })).toBeDefined();
  });
});
