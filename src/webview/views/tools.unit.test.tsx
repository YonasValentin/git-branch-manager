import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const sendMessageMock = vi.fn();
vi.mock('../bridge', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  onMessage: () => () => {},
}));

import { ToolsView } from './tools';

beforeEach(() => sendMessageMock.mockReset());

describe('ToolsView — Settings tab protected branches', () => {
  test('protected branches render inside Badge spans (outline tone), not plain divs', () => {
    render(
      <ToolsView
        cleanupRules={[]}
        recoveryLog={[]}
        protectedBranches={['main', 'release']}
        staleDays={30}
        onAddToast={vi.fn()}
      />,
    );
    // Switch to Settings tab where protected branches live
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));

    // The branch name appears as a child of a Badge — Badge renders a <span>
    // with the outline tone (border-strong styling). Walk up the DOM to confirm.
    const mainText = screen.getByText('main');
    const badge = mainText.closest('span');
    expect(badge).not.toBeNull();
    expect(badge?.tagName).toBe('SPAN');
    // Outline tone draws its border from --border-strong
    expect(badge?.getAttribute('style') ?? '').toContain('var(--border-strong)');
  });

  test('Shield icon appears alongside each protected branch name', () => {
    const { container } = render(
      <ToolsView
        cleanupRules={[]}
        recoveryLog={[]}
        protectedBranches={['main']}
        staleDays={30}
        onAddToast={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    const main = screen.getByText('main');
    const badge = main.closest('span');
    // Shield icon is a child SVG of the badge
    expect(badge?.querySelector('svg')).not.toBeNull();
  });
});
