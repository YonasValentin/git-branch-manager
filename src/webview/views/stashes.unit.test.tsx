import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('../bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { StashesView } from './stashes';
import type { RepoStash } from '../types';

const stash = (over: Partial<RepoStash> = {}): RepoStash => ({
  index: 0,
  message: 'WIP work',
  branch: 'feat/x',
  date: '2d ago',
  filesChanged: 3,
  files: [],
  ...over,
});

beforeEach(() => {
  sendMessageMock.mockReset();
});

describe('StashesView', () => {
  test('renders empty state when no stashes', () => {
    render(<StashesView stashes={[]} onAddToast={vi.fn()} />);
    expect(screen.getByText(/No stashes/i)).toBeDefined();
  });

  test('renders one stash row per stash', () => {
    render(<StashesView stashes={[stash({ index: 0 }), stash({ index: 1 })]} onAddToast={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Apply/i })).toHaveLength(2);
  });

  test('"New stash" button sends createStash', () => {
    render(<StashesView stashes={[]} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /New stash/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('createStash');
  });

  test('Apply button sends applyStash with index', () => {
    render(<StashesView stashes={[stash({ index: 2 })]} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(sendMessageMock).toHaveBeenCalledWith('applyStash', { index: 2 });
  });

  test('Pop button sends popStash with index', () => {
    render(<StashesView stashes={[stash({ index: 1 })]} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pop' }));
    expect(sendMessageMock).toHaveBeenCalledWith('popStash', { index: 1 });
  });

  test('Drop button sends dropStash with index', () => {
    render(<StashesView stashes={[stash({ index: 0 })]} onAddToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    expect(sendMessageMock).toHaveBeenCalledWith('dropStash', { index: 0 });
  });

  test('action buttons fire toast notifications', () => {
    const onAddToast = vi.fn();
    render(<StashesView stashes={[stash({ index: 5 })]} onAddToast={onAddToast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onAddToast).toHaveBeenCalledWith({ title: 'Applied stash 5' });
  });

  test('renders stash message and metadata', () => {
    render(<StashesView stashes={[stash({ message: 'WIP feature work', branch: 'feat/x' })]} onAddToast={vi.fn()} />);
    expect(screen.getByText('WIP feature work')).toBeDefined();
    expect(screen.getByText('feat/x')).toBeDefined();
  });
});
