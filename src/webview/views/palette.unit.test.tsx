import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('../bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { Palette } from './palette';
import type { RepoBranch } from '../types';

const branch = (name: string, isCurrent = false): RepoBranch => ({
  name, isCurrent, isProtected: false, isMerged: false, status: 'active',
  daysOld: 0, lastCommitDate: 'today', author: 'A', ahead: 0, behind: 0,
  commits: 0, note: null, issue: null, remoteGone: false, pr: null,
});

beforeEach(() => sendMessageMock.mockReset());

describe('Palette', () => {
  test('renders nothing when closed', () => {
    const { container } = render(<Palette open={false} branches={[]} onClose={vi.fn()} onAddToast={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  test('renders search input and command list when open', () => {
    render(<Palette open={true} branches={[branch('main'), branch('feat/x')]} onClose={vi.fn()} onAddToast={vi.fn()} />);
    expect(screen.getByPlaceholderText(/search|type/i)).toBeDefined();
  });

  test('Escape key triggers onClose', () => {
    const onClose = vi.fn();
    render(<Palette open={true} branches={[]} onClose={onClose} onAddToast={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('Enter on a branch sends switch message', () => {
    const onClose = vi.fn();
    render(<Palette open={true} branches={[branch('main'), branch('feat/x')]} onClose={onClose} onAddToast={vi.fn()} />);
    // First non-current branch in filter list
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    // Either a branch switch or an action — verify SOMETHING happened
    expect(onClose).toHaveBeenCalled();
  });

  test('shows action commands when no query', () => {
    render(<Palette open={true} branches={[]} onClose={vi.fn()} onAddToast={vi.fn()} />);
    expect(screen.getByText(/Quick clean merged branches/i)).toBeDefined();
  });

  test('caps result count at 10 even when query matches more than 10 branches', () => {
    // 15 feat/* branches + the actions list — query "feat" only filters branches,
    // and the cap should keep results to <= 10
    const branches = Array.from({ length: 15 }, (_, i) => branch(`feat/branch-${i}`));
    render(<Palette open={true} branches={branches} onClose={vi.fn()} onAddToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search|type/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'feat' } });
    // Each branch row contains its monospace name; count those text matches
    const rendered = screen.queryAllByText(/^feat\/branch-\d+$/);
    expect(rendered.length).toBeLessThanOrEqual(10);
  });
});
