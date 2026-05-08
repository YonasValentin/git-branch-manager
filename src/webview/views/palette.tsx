// Command palette (⌘K).

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RepoBranch, ToastData } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage } from '../bridge';
import { Kbd } from '../components';
import * as I from '../icons';

interface PaletteProps {
  open: boolean;
  branches: RepoBranch[];
  onClose: () => void;
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
}

interface PaletteItem {
  kind: 'action' | 'branch';
  icon: React.ReactNode;
  title: string;
  group: string;
  branch?: RepoBranch;
  kbd?: string[];
}

export const Palette: React.FC<PaletteProps> = ({ open, branches, onClose, onAddToast }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const allCommands = useMemo<PaletteItem[]>(() => [
    { kind: 'action', icon: <I.Plus size={13} />,     title: 'New branch from template',    group: 'Actions', kbd: ['⌘', '⇧', 'N'] },
    { kind: 'action', icon: <I.Zap size={13} />,      title: 'Quick clean merged branches',  group: 'Actions' },
    { kind: 'action', icon: <I.Stash size={13} />,    title: 'Stash current changes',        group: 'Actions' },
    { kind: 'action', icon: <I.GitMerge size={13} />, title: 'Merge into main…',             group: 'Actions' },
    { kind: 'action', icon: <I.Tree size={13} />,     title: 'Create worktree from branch…', group: 'Actions' },
    { kind: 'action', icon: <I.Refresh size={13} />,  title: 'Fetch and prune remotes',      group: 'Actions' },
    ...branches.filter(b => !b.isCurrent).map(b => ({
      kind: 'branch' as const,
      icon: <I.Branch size={13} />,
      title: b.name,
      group: 'Switch to branch',
      branch: b,
    })),
  ], [branches]);

  const filtered = query
    ? allCommands.filter(c => c.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
    : allCommands.slice(0, 10);

  const grouped = useMemo(() => {
    const m: Record<string, PaletteItem[]> = {};
    filtered.forEach(c => { (m[c.group] = m[c.group] || []).push(c); });
    return Object.entries(m);
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
      if (e.key === 'Enter') {
        const item = filtered[active];
        if (!item) return;
        if (item.kind === 'branch' && item.branch) {
          sendMessage('switch', { branchName: item.branch.name });
          onAddToast({ title: `Switched to ${item.branch.name}` });
        } else {
          onAddToast({ title: item.title });
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, active, onClose, onAddToast]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '12vh', zIndex: 100,
      animation: 'fade-in 0.12s ease',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 560, maxWidth: '90%',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-popover)',
        overflow: 'hidden',
        animation: 'slide-up 0.15s ease',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <I.Search size={16} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Type a branch, command, or PR number…"
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--fg-strong)', fontSize: TOKENS.fs.lg, fontFamily: 'var(--font-sans)',
            }}
          />
          <Kbd>esc</Kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 420, overflowY: 'auto', padding: 6 }}>
          {grouped.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: TOKENS.fs.base }}>
              No matches
            </div>
          ) : grouped.map(([group, items]) => {
            const first = items[0];
            const startIdx = first ? filtered.indexOf(first) : -1;
            return (
              <div key={group}>
                <div style={{
                  fontSize: TOKENS.fs.xs, fontWeight: 600, color: 'var(--fg-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '8px 10px 4px',
                }}>{group}</div>
                {items.map((c, i) => {
                  const idx = startIdx + i;
                  const isActive = idx === active;
                  return (
                    <button key={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        if (c.kind === 'branch' && c.branch) {
                          sendMessage('switch', { branchName: c.branch.name });
                          onAddToast({ title: `Switched to ${c.branch.name}` });
                        } else {
                          onAddToast({ title: c.title });
                        }
                        onClose();
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '8px 10px',
                        background: isActive ? 'var(--bg-hover)' : 'transparent',
                        color: isActive ? 'var(--fg-strong)' : 'var(--fg)',
                        border: 'none', borderRadius: 6,
                        fontSize: TOKENS.fs.base, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                      }}>
                      <span style={{ color: 'var(--fg-muted)', display: 'flex', flexShrink: 0 }}>{c.icon}</span>
                      <span style={{
                        fontFamily: c.kind === 'branch' ? 'var(--font-mono)' : 'inherit',
                        fontSize: c.kind === 'branch' ? TOKENS.fs.md + 0.5 : TOKENS.fs.base,
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{c.title}</span>
                      {c.kbd && (
                        <span style={{ display: 'flex', gap: 2 }}>
                          {c.kbd.map((k, ki) => <Kbd key={ki}>{k}</Kbd>)}
                        </span>
                      )}
                      {isActive && <I.ArrowRight size={12} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '8px 14px', borderTop: '1px solid var(--border)',
          fontSize: TOKENS.fs.sm, color: 'var(--fg-muted)',
        }}>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Kbd>↵</Kbd> select</span>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
};
