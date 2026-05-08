import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('../bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { CompareView } from './compare';
import type { RepoBranch } from '../types';

const branch = (name: string): RepoBranch => ({
  name,
  isCurrent: false,
  isProtected: false,
  isMerged: false,
  status: 'active',
  daysOld: 1,
  lastCommitDate: 'today',
  author: 'Test',
  ahead: 0,
  behind: 0,
  commits: 0,
  note: null,
  issue: null,
  remoteGone: false,
  pr: null,
});

beforeEach(() => sendMessageMock.mockReset());

describe('CompareView', () => {
  test('renders Compare button', () => {
    render(<CompareView branches={[branch('main'), branch('feat/x')]} currentBranch="feat/x" defaultBranch="main" onAddToast={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Compare$/i })).toBeDefined();
  });

  test('clicking Compare sends compareBranches with current and default', () => {
    render(<CompareView branches={[branch('main'), branch('feat/x')]} currentBranch="feat/x" defaultBranch="main" onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Compare$/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('compareBranches', {
      branchA: 'feat/x',
      branchB: 'main',
    });
  });

  test('renders the base picker label', () => {
    render(<CompareView branches={[branch('main'), branch('feat/x')]} currentBranch="feat/x" defaultBranch="main" onAddToast={vi.fn()} />);
    expect(screen.getByText(/^Base$/i)).toBeDefined();
  });

  test('shows tagline', () => {
    render(<CompareView branches={[]} currentBranch="" defaultBranch="" onAddToast={vi.fn()} />);
    expect(screen.getByText(/See what's different/i)).toBeDefined();
  });
});
