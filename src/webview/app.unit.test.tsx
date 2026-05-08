import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('./bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { App } from './app';
import type { InitialData } from './types';

beforeEach(() => {
  sendMessageMock.mockReset();
  // App reads from window.INITIAL_DATA
  (window as unknown as { INITIAL_DATA: InitialData }).INITIAL_DATA = {
    repo: {
      name: 'demo', path: '/demo', currentBranch: 'main', remote: 'origin',
      remoteUrl: '', defaultBranch: 'main', protectedBranches: [], staleDays: 30,
    },
    authors: {},
    branches: [],
    remoteBranches: [],
    worktrees: [],
    stashes: [],
    cleanupRules: [],
    recoveryLog: [],
  };
});

describe('Sidebar footer support actions', () => {
  test('Sponsor button posts openSponsor', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /sponsor on github/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('openSponsor');
  });

  test('Buy Me a Coffee button posts openSupport', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /buy me a coffee/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('openSupport');
  });

  test('Report Issue button posts openGithub', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /report an issue/i }));
    expect(sendMessageMock).toHaveBeenCalledWith('openGithub');
  });

  test('command palette hint stays visible above the support row', () => {
    render(<App />);
    expect(screen.getByText(/command palette/i)).toBeDefined();
  });
});
