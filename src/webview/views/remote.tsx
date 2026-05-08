// Remote branches view.

import React, { useState } from 'react';
import { RepoRemote, RepoInfo, AuthorInfo, ToastData } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage } from '../bridge';
import { Button, IconButton, Badge, Chip, SearchInput, Checkbox, Empty, ActionBarButton } from '../components';
import { getAuthor } from '../components';
import * as I from '../icons';

interface RemoteViewProps {
  remoteBranches: RepoRemote[];
  repo: RepoInfo;
  authors: Record<string, AuthorInfo>;
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
}

export const RemoteView: React.FC<RemoteViewProps> = ({ remoteBranches, repo, authors, onAddToast }) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'merged' | 'stale' | 'gone'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = remoteBranches.filter(b => {
    if (query && !b.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === 'merged') return b.isMerged;
    if (filter === 'stale') return b.daysOld > 30 && !b.isMerged;
    if (filter === 'gone') return b.isGone;
    return true;
  });

  const counts = {
    all: remoteBranches.length,
    merged: remoteBranches.filter(b => b.isMerged).length,
    stale: remoteBranches.filter(b => b.daysOld > 30 && !b.isMerged).length,
    gone: remoteBranches.filter(b => b.isGone).length,
  };

  const toggle = (name: string) => {
    const s = new Set(selected);
    s.has(name) ? s.delete(name) : s.add(name);
    setSelected(s);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: `12px ${TOKENS.sectionPx}px`,
        borderBottom: '1px solid var(--border)',
      }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search remote branches…" style={{ flex: 1 }} />
        <Button variant="secondary" size="md" icon={<I.Refresh size={13} />}
                onClick={() => { sendMessage('refresh'); onAddToast({ title: 'Fetched origin' }); }}>Fetch</Button>
        <Button variant="secondary" size="md" icon={<I.Trash size={13} />}
                onClick={() => onAddToast({ title: 'Pruned remote refs' })}>Prune</Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: `${TOKENS.contentPy}px ${TOKENS.sectionPx}px`, position: 'relative' }}>
        {/* Remote info card */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '14px 16px', marginBottom: 14,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: TOKENS.radius.lg,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: 'var(--bg-raised)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)',
          }}>
            <I.Github size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: TOKENS.fs.body, fontWeight: 500 }}>{repo.remote} · {repo.remoteUrl}</div>
            <div style={{ fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-muted)', marginTop: 2 }}>
              {remoteBranches.length} remote branches
            </div>
          </div>
          <Badge tone="healthy">in sync</Badge>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={counts.all}>All</Chip>
          <Chip active={filter === 'merged'} onClick={() => setFilter('merged')} tone="info" count={counts.merged}>Merged</Chip>
          <Chip active={filter === 'stale'} onClick={() => setFilter('stale')} tone="warning" count={counts.stale}>Stale</Chip>
          <Chip active={filter === 'gone'} onClick={() => setFilter('gone')} tone="danger" count={counts.gone}>Gone</Chip>
        </div>

        {/* Branch list */}
        {filtered.length === 0 ? (
          <Empty icon={<I.Cloud size={20} />} title="No remote branches" detail="Try a different filter." />
        ) : (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: TOKENS.radius.lg, overflow: 'hidden' }}>
            {filtered.map((b, i) => {
              const authorName = getAuthor(b.author, authors).name.split(' ')[0];
              return (
                <div key={b.name} style={{
                  display: 'grid', gridTemplateColumns: '16px minmax(0,1fr) auto auto auto auto',
                  alignItems: 'center', gap: 14, padding: '10px 14px',
                  borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--border)',
                }}>
                  <Checkbox checked={selected.has(b.name)} onChange={() => toggle(b.name)} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.body, fontWeight: 500, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.name}
                      </span>
                      {b.isMerged && <Badge tone="info" size="sm" icon={<I.GitMerge size={9} />}>merged</Badge>}
                      {b.isGone && <Badge tone="danger" size="sm">gone</Badge>}
                      {b.daysOld > 30 && !b.isMerged && <Badge tone="warning" size="sm">stale</Badge>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-subtle)', marginTop: 3 }}>
                      {authorName}
                      <span style={{ color: 'var(--fg-faint)' }}>·</span>
                      <span>{b.daysOld}d old</span>
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm, color: b.behind ? 'var(--warning)' : 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>
                    ↓{b.behind}
                  </div>
                  <Button size="sm" variant="outline" icon={<I.Download size={11} />}>Checkout</Button>
                  <Button size="sm" variant="ghost">Compare</Button>
                  <IconButton size={26} label="More"><I.More size={14} /></IconButton>
                </div>
              );
            })}
          </div>
        )}

        {/* Floating multi-select bar */}
        {selected.size > 0 && (
          <div style={{
            position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px 8px 14px',
            background: 'var(--bg-raised)', border: '1px solid var(--border-strong)', borderRadius: TOKENS.radius.lg,
            boxShadow: 'var(--shadow-toast)', zIndex: 30,
          }}>
            <span style={{ fontSize: TOKENS.fs.base + 0.5, fontWeight: 500 }}>{selected.size} selected</span>
            <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
            <Button size="sm" variant="ghost" icon={<I.Download size={12} />}>Checkout all</Button>
            <Button size="sm" variant="danger" icon={<I.Trash size={12} />}
                    onClick={() => {
                      const names = Array.from(selected);
                      sendMessage('deleteMultiple', { branchNames: names });
                      onAddToast({ title: `Deleted ${names.length} remote branches`, tone: 'danger' });
                      setSelected(new Set());
                    }}>Delete on remote</Button>
            <IconButton size={26} label="Clear" onClick={() => setSelected(new Set())}><I.X size={12} /></IconButton>
          </div>
        )}
      </div>
    </div>
  );
};
