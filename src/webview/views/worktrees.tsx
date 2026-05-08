// Worktrees view — card grid layout.

import React from 'react';
import { RepoWorktree, ToastData } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage } from '../bridge';
import { Button, IconButton, Badge } from '../components';
import * as I from '../icons';

interface WorktreesViewProps {
  worktrees: RepoWorktree[];
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
}

export const WorktreesView: React.FC<WorktreesViewProps> = ({ worktrees, onAddToast }) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {/* Header */}
    <div style={{
      padding: `12px ${TOKENS.sectionPx}px`, borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: TOKENS.fs.body, fontWeight: 500, color: 'var(--fg-strong)' }}>Worktrees</div>
        <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', marginTop: 1 }}>Multiple working directories sharing one repo</div>
      </div>
      <Button variant="primary" size="md" icon={<I.Plus size={13} />}
              onClick={() => sendMessage('createWorktree')}>New worktree</Button>
      <IconButton size={32} label="Prune" onClick={() => onAddToast({ title: 'Pruned worktrees' })}>
        <I.Trash size={14} />
      </IconButton>
    </div>

    <div style={{ flex: 1, overflowY: 'auto', padding: `${TOKENS.contentPy}px ${TOKENS.sectionPx}px` }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
        {worktrees.map((w, i) => (
          <div key={i} style={{
            padding: '14px 16px', background: 'var(--bg-elevated)',
            border: w.isMain ? '1px solid var(--accent-ring)' : '1px solid var(--border)',
            borderRadius: TOKENS.radius.lg, position: 'relative',
          }}>
            {w.isMain && (
              <div style={{ position: 'absolute', top: 12, right: 12 }}>
                <Badge tone="accent" icon={<I.CircleDot size={9} />}>active</Badge>
              </div>
            )}
            {w.isLocked && !w.isMain && (
              <div style={{ position: 'absolute', top: 12, right: 12 }}>
                <Badge tone="warning" icon={<I.Lock size={9} />}>locked</Badge>
              </div>
            )}
            {w.prunable && !w.isMain && !w.isLocked && (
              <div style={{ position: 'absolute', top: 12, right: 12 }}>
                <Badge tone="danger">prunable</Badge>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: w.isMain ? 'var(--accent-soft)' : 'var(--bg-raised)',
                color: w.isMain ? 'var(--accent)' : 'var(--fg-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <I.Folder size={16} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.base + 0.5, fontWeight: 500, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.path}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: TOKENS.fs.md, color: 'var(--fg-muted)' }}>
                  <I.Branch size={11} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm + 0.5 }}>{w.branch}</span>
                </div>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)' }}>last activity {w.lastActivity}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button size="sm" variant="ghost" icon={<I.Eye size={11} />}
                        onClick={() => onAddToast({ title: `Opening ${w.path}` })}>Open</Button>
                {!w.isMain && (
                  <IconButton size={26} label="Remove"
                              onClick={() => onAddToast({ title: `Removed worktree`, detail: w.path })}>
                    <I.Trash size={12} />
                  </IconButton>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Add card */}
        <button
          onClick={() => sendMessage('createWorktree')}
          style={{
            padding: '14px 16px', background: 'transparent',
            border: '1.5px dashed var(--border-strong)', borderRadius: TOKENS.radius.lg,
            color: 'var(--fg-muted)', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 6, minHeight: 132, cursor: 'pointer', fontFamily: 'inherit', fontSize: TOKENS.fs.body,
          }}>
          <I.Plus size={18} />
          <span>Create worktree</span>
          <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)' }}>work on multiple branches in parallel</span>
        </button>
      </div>
    </div>
  </div>
);
