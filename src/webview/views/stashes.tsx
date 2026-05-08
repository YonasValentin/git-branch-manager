// Stashes view.

import React from 'react';
import { RepoStash, ToastData } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage } from '../bridge';
import { Button, Empty } from '../components';
import * as I from '../icons';

interface StashesViewProps {
  stashes: RepoStash[];
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
}

export const StashesView: React.FC<StashesViewProps> = ({ stashes, onAddToast }) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {/* Header */}
    <div style={{
      padding: `12px ${TOKENS.sectionPx}px`, borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: TOKENS.fs.body, fontWeight: 500, color: 'var(--fg-strong)' }}>Stashes</div>
        <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', marginTop: 1 }}>Saved work-in-progress snapshots</div>
      </div>
      <Button variant="primary" size="md" icon={<I.Plus size={13} />}
              onClick={() => sendMessage('createStash')}>New stash</Button>
    </div>

    <div style={{ flex: 1, overflowY: 'auto', padding: `${TOKENS.contentPy}px ${TOKENS.sectionPx}px` }}>
      {stashes.length === 0 ? (
        <Empty icon={<I.Stash size={20} />} title="No stashes" detail="Run git stash to save work in progress." />
      ) : (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: TOKENS.radius.lg, overflow: 'hidden' }}>
          {stashes.map((s, i) => (
            <div key={s.index} style={{
              display: 'grid',
              gridTemplateColumns: '36px minmax(0,1fr) auto auto auto',
              alignItems: 'center', gap: 14,
              padding: `${TOKENS.toolbarPy}px 14px`,
              borderBottom: i === stashes.length - 1 ? 'none' : '1px solid var(--border)',
            }}>
              {/* Index */}
              <div style={{
                width: 28, height: 28, borderRadius: 7, background: 'var(--bg-raised)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm, color: 'var(--fg-muted)',
              }}>{s.index}</div>

              {/* Message + meta */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: TOKENS.fs.body, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.message}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-subtle)', marginTop: 3 }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{s.branch}</span>
                  <span style={{ color: 'var(--fg-faint)' }}>·</span>
                  <span>{s.date}</span>
                  <span style={{ color: 'var(--fg-faint)' }}>·</span>
                  <span>{s.filesChanged} {s.filesChanged === 1 ? 'file' : 'files'}</span>
                </div>
              </div>

              {/* Actions */}
              <Button size="sm" variant="outline"
                      onClick={() => { sendMessage('applyStash', { index: s.index }); onAddToast({ title: `Applied stash ${s.index}` }); }}>
                Apply
              </Button>
              <Button size="sm" variant="secondary"
                      onClick={() => { sendMessage('popStash', { index: s.index }); onAddToast({ title: `Popped stash ${s.index}` }); }}>
                Pop
              </Button>
              <Button size="sm" variant="ghost" danger
                      onClick={() => { sendMessage('dropStash', { index: s.index }); onAddToast({ title: `Dropped stash ${s.index}`, tone: 'danger' }); }}>
                Drop
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);
