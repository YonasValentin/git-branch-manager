// Branch detail drawer — slides in from the right.

import React from 'react';
import { RepoBranch, AuthorInfo, ToastData, CompareResult } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage } from '../bridge';
import { Button, IconButton, StatRow, StatusDot } from '../components';
import { getAuthor } from '../components';
import * as I from '../icons';

interface DrawerProps {
  branch: RepoBranch;
  authors: Record<string, AuthorInfo>;
  compareCommits: CompareResult;
  onClose: () => void;
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-muted)', letterSpacing: '0.02em' }}>{children}</div>
);

export const Drawer: React.FC<DrawerProps> = ({ branch, authors, compareCommits, onClose, onAddToast }) => {
  const a = getAuthor(branch.author, authors);

  const statusBits = [
    branch.isCurrent && { text: 'current', color: 'var(--accent)' },
    branch.isProtected && { text: 'protected', color: 'var(--fg-muted)' },
    branch.status === 'merged' && { text: 'merged into main', color: 'var(--info)' },
    branch.status === 'stale' && { text: `${branch.daysOld}d stale`, color: 'var(--warning)' },
    branch.remoteGone && { text: 'remote gone', color: 'var(--danger)' },
  ].filter(Boolean) as { text: string; color: string }[];

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)',
        animation: 'fade-in 0.15s ease', zIndex: 50,
      }} />

      {/* Panel */}
      <aside style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 460, maxWidth: '90%',
        background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-drawer)',
        display: 'flex', flexDirection: 'column',
        zIndex: 51, animation: 'slide-in-right 0.2s ease',
      }}>
        {/* Header */}
        <div style={{ padding: `16px ${TOKENS.rowPx}px 14px`, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)', letterSpacing: '0.02em' }}>local branch</span>
            <div style={{ flex: 1 }} />
            <IconButton size={24} label="Close" onClick={onClose}><I.X size={12} /></IconButton>
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.lg, fontWeight: 500,
            color: 'var(--fg-strong)', wordBreak: 'break-all', lineHeight: 1.3,
          }}>{branch.name}</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
            fontSize: TOKENS.fs.md, color: 'var(--fg-muted)',
          }}>
            <span>{a.name}</span>
            <span style={{ color: 'var(--fg-faint)' }}>·</span>
            <span>{branch.lastCommitDate}</span>
            <span style={{ color: 'var(--fg-faint)' }}>·</span>
            <span>{branch.commits} commits</span>
            {branch.issue && (
              <><span style={{ color: 'var(--fg-faint)' }}>·</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm + 0.5 }}>{branch.issue}</span></>
            )}
          </div>
          {statusBits.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: TOKENS.fs.md }}>
              {statusBits.map((s, i) => <span key={i} style={{ color: s.color }}>{s.text}</span>)}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Quick actions */}
          <div style={{ padding: `12px ${TOKENS.rowPx}px`, display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
            {!branch.isCurrent && !branch.isProtected && (
              <Button size="sm" variant="primary" onClick={() => {
                sendMessage('switch', { branchName: branch.name });
                onAddToast({ title: `Switched to ${branch.name}` });
                onClose();
              }}>Checkout</Button>
            )}
            <Button size="sm" variant="secondary">Compare</Button>
            <Button size="sm" variant="secondary">Merge into main</Button>
            <Button size="sm" variant="ghost">Rebase</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              navigator.clipboard?.writeText(branch.name);
              onAddToast({ title: 'Branch name copied' });
            }}>Copy name</Button>
          </div>

          {/* Stats */}
          <div style={{ padding: `12px ${TOKENS.rowPx}px`, borderBottom: '1px solid var(--border)', fontSize: TOKENS.fs.base + 0.5 }}>
            <StatRow label="Tracks" value={`origin/${branch.name}`} mono />
            <StatRow label="Ahead" value={branch.ahead} mono valueColor={branch.ahead > 0 ? 'var(--fg-strong)' : 'var(--fg-faint)'} />
            <StatRow label="Behind" value={branch.behind} mono valueColor={branch.behind > 100 ? 'var(--warning)' : (branch.behind > 0 ? 'var(--fg)' : 'var(--fg-faint)')} />
            <StatRow label="Last commit" value={branch.lastCommitDate} />
            <StatRow label="Created" value={`${branch.daysOld} days ago`} />
            {branch.isProtected && <StatRow label="Branch policy" value="protected · no force push" />}
          </div>

          {/* PR */}
          {branch.pr && (
            <div style={{ padding: `14px ${TOKENS.rowPx}px`, borderBottom: '1px solid var(--border)' }}>
              <SectionLabel>Pull request</SectionLabel>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.body, color: 'var(--fg-strong)' }}>#{branch.pr.number}</span>
                  <span style={{ fontSize: TOKENS.fs.sm + 0.5, color: branch.pr.state === 'open' ? 'var(--info)' : 'var(--fg-muted)' }}>{branch.pr.state}</span>
                </div>
                <div style={{ fontSize: TOKENS.fs.body, color: 'var(--fg)', marginBottom: 8, lineHeight: 1.4 }}>{branch.pr.title}</div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-muted)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <StatusDot status={branch.pr.ci} size={6} />
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{branch.pr.checks}</span>
                    <span>{branch.pr.ci}</span>
                  </span>
                  <span style={{ color: 'var(--fg-faint)' }}>·</span>
                  {branch.pr.reviews === 'approved' && <span style={{ color: 'var(--healthy)' }}>approved</span>}
                  {branch.pr.reviews === 'changes_requested' && <span style={{ color: 'var(--warning)' }}>changes requested</span>}
                  {branch.pr.reviews === 'pending' && <span>review pending</span>}
                </div>
              </div>
            </div>
          )}

          {/* Recent commits */}
          <div style={{ padding: `14px ${TOKENS.rowPx}px`, borderBottom: '1px solid var(--border)' }}>
            <SectionLabel>Recent commits</SectionLabel>
            <div style={{ marginTop: 8 }}>
              {compareCommits.ahead.slice(0, 5).map((c, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '56px 1fr auto',
                  alignItems: 'baseline', gap: 10, padding: '5px 0',
                  fontSize: TOKENS.fs.md, borderTop: i ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)' }}>{c.hash}</span>
                  <span style={{ color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>
                  <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)' }}>{c.date}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Note */}
          <div style={{ padding: `14px ${TOKENS.rowPx}px`, borderBottom: '1px solid var(--border)' }}>
            <SectionLabel>Note</SectionLabel>
            <textarea
              defaultValue={branch.note || ''}
              placeholder="Add a private note for this branch…"
              onBlur={(e) => sendMessage('saveNote', { branchName: branch.name, note: e.target.value })}
              style={{
                width: '100%', minHeight: 56, marginTop: 8,
                padding: '8px 10px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 5,
                color: 'var(--fg)', fontSize: TOKENS.fs.base + 0.5, fontFamily: 'inherit',
                outline: 'none', resize: 'vertical', lineHeight: 1.45,
              }}
            />
          </div>

          {/* Delete */}
          {!branch.isProtected && !branch.isCurrent && (
            <div style={{ padding: `14px ${TOKENS.rowPx}px` }}>
              <SectionLabel>Delete</SectionLabel>
              <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', margin: '8px 0 10px', lineHeight: 1.5 }}>
                {branch.isMerged
                  ? 'Merged into main — safe to delete.'
                  : 'Has unmerged commits. Force delete is destructive but recoverable from reflog within 30 days.'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" variant="danger" onClick={() => {
                  sendMessage('delete', { branchName: branch.name });
                  onAddToast({ title: `Deleted ${branch.name}`, detail: 'preserved in reflog · 30 day recovery', canUndo: true, tone: 'danger' });
                  onClose();
                }}>Delete branch</Button>
                {!branch.isMerged && (
                  <Button size="sm" variant="ghost" onClick={() => {
                    sendMessage('delete', { branchName: branch.name, force: true });
                    onAddToast({ title: `Force deleted ${branch.name}`, tone: 'danger' });
                    onClose();
                  }}>Force delete</Button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
