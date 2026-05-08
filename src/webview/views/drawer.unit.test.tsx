import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('../bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { Drawer } from './drawer';
import type { RepoBranch, AuthorInfo, CompareResult } from '../types';

const branch = (over: Partial<RepoBranch> = {}): RepoBranch => ({
  name: 'feat/x',
  isCurrent: false,
  isProtected: false,
  isMerged: false,
  status: 'active',
  daysOld: 1,
  lastCommitDate: 'today',
  author: 'Alice',
  ahead: 1,
  behind: 0,
  commits: 1,
  note: null,
  issue: null,
  remoteGone: false,
  pr: null,
  ...over,
});

const authors: Record<string, AuthorInfo> = {
  Alice: { name: 'Alice', initials: 'A', color: '#34d399' },
};

const compareCommits: CompareResult = { ahead: [], behind: [], files: [] };

beforeEach(() => sendMessageMock.mockReset());

describe('Drawer', () => {
  test('renders branch name', () => {
    render(<Drawer branch={branch()} authors={authors} compareCommits={compareCommits} onClose={vi.fn()} onAddToast={vi.fn()} />);
    expect(screen.getByText('feat/x')).toBeDefined();
  });

  test('Checkout button sends switch with branchName', () => {
    render(<Drawer branch={branch()} authors={authors} compareCommits={compareCommits} onClose={vi.fn()} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Checkout/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('switch', { branchName: 'feat/x' });
  });

  test('Delete button sends delete with branchName', () => {
    render(<Drawer branch={branch()} authors={authors} compareCommits={compareCommits} onClose={vi.fn()} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('delete', { branchName: 'feat/x' });
  });

  test('Close button invokes onClose callback', () => {
    const onClose = vi.fn();
    render(<Drawer branch={branch()} authors={authors} compareCommits={compareCommits} onClose={onClose} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  test('shows "current" status when branch is current', () => {
    render(<Drawer branch={branch({ isCurrent: true })} authors={authors} compareCommits={compareCommits} onClose={vi.fn()} onAddToast={vi.fn()} />);
    expect(screen.getByText('current')).toBeDefined();
  });

  test('shows "merged into main" when status is merged', () => {
    render(<Drawer branch={branch({ status: 'merged' })} authors={authors} compareCommits={compareCommits} onClose={vi.fn()} onAddToast={vi.fn()} />);
    expect(screen.getByText('merged into main')).toBeDefined();
  });
});
