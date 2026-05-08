import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { Button, IconButton, Chip } from './components';

describe('focus-ring class is applied to interactive primitives', () => {
  test('Button gets className "focus-ring"', () => {
    render(<Button>Click</Button>);
    const btn = screen.getByRole('button', { name: 'Click' });
    expect(btn.className).toContain('focus-ring');
  });

  test('IconButton gets className "focus-ring"', () => {
    render(<IconButton label="Close">x</IconButton>);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('focus-ring');
  });

  test('Chip gets className "focus-ring"', () => {
    render(<Chip active={false} onClick={vi.fn()}>show</Chip>);
    const btn = screen.getByRole('button', { name: 'show' });
    expect(btn.className).toContain('focus-ring');
  });
});
