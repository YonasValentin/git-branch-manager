import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('../bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { WorktreesView } from './worktrees';
import type { RepoWorktree } from '../types';

const wt = (over: Partial<RepoWorktree> = {}): RepoWorktree => ({
  path: '/repo/worktree',
  branch: 'feat/x',
  isMain: false,
  isLocked: false,
  prunable: false,
  lastActivity: '2d ago',
  ...over,
});

beforeEach(() => sendMessageMock.mockReset());

describe('WorktreesView', () => {
  test('shows the "active" badge for the main worktree', () => {
    render(<WorktreesView worktrees={[wt({ isMain: true })]} onAddToast={vi.fn()} />);
    expect(screen.getByText('active')).toBeDefined();
  });

  test('shows the "locked" badge for locked non-main worktree', () => {
    render(<WorktreesView worktrees={[wt({ isLocked: true })]} onAddToast={vi.fn()} />);
    expect(screen.getByText('locked')).toBeDefined();
  });

  test('shows the "prunable" badge for prunable worktree', () => {
    render(<WorktreesView worktrees={[wt({ prunable: true })]} onAddToast={vi.fn()} />);
    expect(screen.getByText('prunable')).toBeDefined();
  });

  test('"New worktree" button sends createWorktree', () => {
    render(<WorktreesView worktrees={[]} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /New worktree/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('createWorktree');
  });

  test('renders worktree path and branch', () => {
    render(<WorktreesView worktrees={[wt({ path: '/x/repo-feat', branch: 'feat/y' })]} onAddToast={vi.fn()} />);
    expect(screen.getByText('/x/repo-feat')).toBeDefined();
    expect(screen.getByText('feat/y')).toBeDefined();
  });
});
