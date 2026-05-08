// Local branches view — the primary tab.

import React, { useState, useMemo } from 'react';
import { RepoBranch, AuthorInfo, ToastData } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage } from '../bridge';
import { Checkbox, StatusDot, Chip, SearchInput, Dropdown, Empty, ActionBarButton } from '../components';
import * as I from '../icons';

// Single-character status mark — typography over decoration.
const StatusMark: React.FC<{ b: RepoBranch }> = ({ b }) => {
  if (b.isCurrent) return <span style={{ color: 'var(--accent)' }}>●</span>;
  if (b.remoteGone) return <span style={{ color: 'var(--danger)' }}>!</span>;
  if (b.status === 'merged') return <span style={{ color: 'var(--info)' }}>M</span>;
  if (b.status === 'stale') return <span style={{ color: 'var(--warning)' }}>~</span>;
  return <span style={{ color: 'var(--fg-faint)' }}>·</span>;
};

interface BranchRowProps {
  b: RepoBranch;
  selected: boolean;
  anySelected: boolean;
  onSelectToggle: (b: RepoBranch) => void;
  onClick: (b: RepoBranch) => void;
  onSwitch: (b: RepoBranch) => void;
  density?: string;
  isActive: boolean;
  authors: Record<string, AuthorInfo>;
}

const BranchRow: React.FC<BranchRowProps> = ({
  b, selected, anySelected, onSelectToggle, onClick, onSwitch, density = 'cozy', isActive, authors,
}) => {
  const [hover, setHover] = useState(false);

  const hint = (() => {
    if (b.isCurrent) return null;
    if (b.remoteGone) return { text: 'remote gone', color: 'var(--danger)' };
    if (b.status === 'merged') return { text: 'merged into main', color: 'var(--info)' };
    if (b.status === 'stale') return { text: `${b.daysOld}d stale`, color: 'var(--warning)' };
    if (b.behind > 100) return { text: `${b.behind} behind`, color: 'var(--fg-muted)' };
    return null;
  })();

  const authorName = authors[b.author]?.name?.split(' ')[0] ?? b.author;

  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => onClick(b)}
      style={{
        display: 'grid',
        gridTemplateColumns: TOKENS.listGridCols,
        alignItems: 'center', columnGap: 14,
        padding: `var(--row-py) ${TOKENS.rowPx}px var(--row-py) 12px`,
        background: isActive || selected ? 'var(--bg-selected)' : (hover ? 'var(--bg-hover)' : 'transparent'),
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer', position: 'relative',
      }}
    >
      {/* Checkbox */}
      <div onClick={(e) => e.stopPropagation()} style={{
        opacity: (hover || selected || anySelected) && !b.isProtected ? 1 : 0,
        transition: 'opacity 0.1s',
      }}>
        {!b.isProtected && <Checkbox checked={selected} onChange={() => onSelectToggle(b)} />}
      </div>

      {/* Status mark */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.body, textAlign: 'center', lineHeight: 1 }}>
        <StatusMark b={b} />
      </div>

      {/* Name + sub-line */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.body, fontWeight: 450,
            color: b.isCurrent ? 'var(--fg-strong)' : 'var(--fg)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{b.name}</span>
          {b.isProtected && <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-faint)' }}>protected</span>}
          {b.issue && !b.isProtected && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)' }}>{b.issue}</span>
          )}
          {hint && <span style={{ fontSize: TOKENS.fs.sm + 0.5, color: hint.color }}>{hint.text}</span>}
        </div>
        {density !== 'compact' && (
          <div style={{ fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {authorName} · {b.lastCommitDate}
            {b.note && <span style={{ color: 'var(--fg-faint)' }}> — {b.note}</span>}
          </div>
        )}
      </div>

      {/* PR + CI */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end',
        fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-muted)',
      }}>
        {b.pr ? (
          <>
            <span>#{b.pr.number}</span>
            <StatusDot status={b.pr.ci} size={6} />
            {b.pr.state === 'draft' && <span style={{ color: 'var(--fg-subtle)' }}>draft</span>}
          </>
        ) : <span style={{ color: 'var(--fg-faint)' }}>—</span>}
      </div>

      {/* Ahead / Behind */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm + 0.5, fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{ color: b.ahead === 0 ? 'var(--fg-faint)' : 'var(--fg)' }}>↑{b.ahead}</span>
        <span style={{ color: b.behind === 0 ? 'var(--fg-faint)' : (b.behind > 100 ? 'var(--warning)' : 'var(--fg-muted)') }}>↓{b.behind}</span>
      </div>

      {/* Hover action */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
        {hover && !b.isCurrent && !b.isProtected ? (
          <button onClick={() => onSwitch(b)} style={{
            height: 22, padding: '0 8px',
            background: 'transparent', border: '1px solid var(--border-strong)',
            borderRadius: TOKENS.radius.sm, color: 'var(--fg)',
            fontSize: TOKENS.fs.sm + 0.5, fontFamily: 'inherit', cursor: 'pointer',
          }}>switch</button>
        ) : <span style={{ width: 22, height: 22 }} />}
      </div>
    </div>
  );
};

interface LocalViewProps {
  branches: RepoBranch[];
  authors: Record<string, AuthorInfo>;
  density?: string;
  groupBy?: string;
  daysUntilStale?: number;
  currentBranch?: string;
  onOpenDrawer: (b: RepoBranch) => void;
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
  activeBranch?: RepoBranch | null;
}

export const LocalView: React.FC<LocalViewProps> = ({
  branches, authors, groupBy: initialGroupBy,
  onOpenDrawer, onAddToast, activeBranch = null,
}) => {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ active: true, merged: true, stale: true, orphaned: true });
  const [sortBy, setSortBy] = useState('age');
  const [groupBy, setGroupBy] = useState(initialGroupBy || 'status');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showProtected, setShowProtected] = useState(false);

  const visible = branches.filter(b => showProtected || !b.isProtected);

  const filtered = useMemo(() => {
    return visible.filter(b => {
      if (query && !b.name.toLowerCase().includes(query.toLowerCase())) return false;
      if (b.remoteGone && !filters.orphaned) return false;
      if (!b.remoteGone && !filters[b.status as keyof typeof filters]) return false;
      return true;
    }).sort((a, b) => {
      if (sortBy === 'age') return b.daysOld - a.daysOld;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'author') return (a.author || '').localeCompare(b.author || '');
      if (sortBy === 'ahead') return b.ahead - a.ahead;
      if (sortBy === 'behind') return b.behind - a.behind;
      return 0;
    });
  }, [visible, query, filters, sortBy]);

  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null as string | null, items: filtered }];
    if (groupBy === 'status') {
      const order = ['merged', 'stale', 'orphaned', 'active'];
      const labels: Record<string, string> = { merged: 'Merged', stale: 'Stale', orphaned: 'Remote gone', active: 'Active' };
      return order.map(key => ({
        key, label: labels[key],
        items: filtered.filter(b => key === 'orphaned' ? b.remoteGone : b.status === key && !b.remoteGone),
      })).filter(g => g.items.length > 0);
    }
    if (groupBy === 'author') {
      const map: Record<string, RepoBranch[]> = {};
      filtered.forEach(b => { (map[b.author] = map[b.author] || []).push(b); });
      return Object.entries(map).map(([k, v]) => ({ key: k, label: authors[k]?.name || k, items: v }));
    }
    if (groupBy === 'prefix') {
      const map: Record<string, RepoBranch[]> = {};
      filtered.forEach(b => {
        const prefix = b.name.includes('/') ? (b.name.split('/')[0] ?? '(no prefix)') : '(no prefix)';
        (map[prefix] = map[prefix] || []).push(b);
      });
      return Object.entries(map).map(([k, v]) => ({ key: k, label: k, items: v }));
    }
    return [{ key: 'all', label: null as string | null, items: filtered }];
  }, [filtered, groupBy, authors]);

  const toggleSelect = (b: RepoBranch) => {
    const s = new Set(selected);
    s.has(b.name) ? s.delete(b.name) : s.add(b.name);
    setSelected(s);
  };

  const counts = {
    total: visible.length,
    merged: visible.filter(b => b.status === 'merged').length,
    stale: visible.filter(b => b.status === 'stale').length,
    orphaned: visible.filter(b => b.remoteGone).length,
    active: visible.filter(b => b.status === 'active' && !b.remoteGone).length,
  };
  const cleanable = branches.filter(b => b.isMerged && !b.isProtected);

  const onSwitch = (b: RepoBranch) => {
    sendMessage('switch', { branchName: b.name });
    onAddToast({ title: `Switched to ${b.name}`, detail: 'HEAD now points to this branch' });
  };

  const onCleanMerged = () => {
    if (!cleanable.length) return;
    sendMessage('deleteMultiple', { branchNames: cleanable.map(b => b.name) });
    onAddToast({ title: `Deleted ${cleanable.length} merged branches`, detail: 'git branch -d · refs preserved in reflog', canUndo: true });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: `${TOKENS.toolbarPy}px ${TOKENS.sectionPx}px`,
        borderBottom: '1px solid var(--border)',
      }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Filter branches…" kbd="/" style={{ flex: 1, maxWidth: 360 }} />
        <div style={{ flex: 1 }} />
        <Dropdown label="group" value={groupBy} options={[
          { value: 'status', label: 'Status' }, { value: 'author', label: 'Author' },
          { value: 'prefix', label: 'Prefix' }, { value: 'none', label: 'None' },
        ]} onChange={setGroupBy} />
        <Dropdown label="sort" value={sortBy} options={[
          { value: 'age', label: 'Age' }, { value: 'name', label: 'Name' },
          { value: 'author', label: 'Author' }, { value: 'ahead', label: 'Ahead' }, { value: 'behind', label: 'Behind' },
        ]} onChange={setSortBy} />
        <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
        <button onClick={() => { sendMessage('refresh'); onAddToast({ title: 'Fetched origin' }); }}
          style={{
            height: 28, padding: '0 10px', background: 'transparent', border: '1px solid var(--border-strong)',
            borderRadius: TOKENS.radius.md, color: 'var(--fg)', fontSize: TOKENS.fs.md,
            fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>fetch</button>
        <button onClick={() => sendMessage('createBranch')}
          style={{
            height: 28, padding: '0 10px', background: 'var(--accent)', border: '1px solid var(--accent)',
            borderRadius: TOKENS.radius.md, color: 'var(--bg)', fontSize: TOKENS.fs.md,
            fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>new branch</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${TOKENS.rowPx}px 80px` }}>
        {/* Quiet status strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '14px 0 12px',
          fontSize: TOKENS.fs.md, color: 'var(--fg-muted)',
          fontVariantNumeric: 'tabular-nums',
          borderBottom: '1px solid var(--border)',
          whiteSpace: 'nowrap', flexWrap: 'wrap',
        }}>
          <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: 'var(--fg)' }}>{counts.total}</span> branches</span>
          {counts.merged > 0 && <><span style={{ color: 'var(--fg-faint)' }}>·</span><span style={{ whiteSpace: 'nowrap' }}><span style={{ color: 'var(--fg)' }}>{counts.merged}</span> merged</span></>}
          {counts.stale > 0 && <><span style={{ color: 'var(--fg-faint)' }}>·</span><span style={{ whiteSpace: 'nowrap' }}><span style={{ color: 'var(--fg)' }}>{counts.stale}</span> stale</span></>}
          {counts.orphaned > 0 && <><span style={{ color: 'var(--fg-faint)' }}>·</span><span style={{ whiteSpace: 'nowrap' }}><span style={{ color: 'var(--fg)' }}>{counts.orphaned}</span> remote gone</span></>}
          <div style={{ flex: 1 }} />
          {cleanable.length > 0 && (
            <button onClick={onCleanMerged} style={{
              background: 'transparent', border: 'none', padding: 0,
              color: 'var(--accent)', fontSize: TOKENS.fs.md, fontFamily: 'inherit', cursor: 'pointer',
              textDecoration: 'underline', textDecorationColor: 'var(--accent-ring)',
              textUnderlineOffset: 3, whiteSpace: 'nowrap',
            }}>delete {cleanable.length} merged</button>
          )}
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '10px 0' }}>
          <span style={{ fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-subtle)', marginRight: 4 }}>show</span>
          <Chip active={filters.active} onClick={() => setFilters(f => ({ ...f, active: !f.active }))} count={counts.active}>active</Chip>
          <Chip active={filters.merged} onClick={() => setFilters(f => ({ ...f, merged: !f.merged }))} count={counts.merged}>merged</Chip>
          <Chip active={filters.stale} onClick={() => setFilters(f => ({ ...f, stale: !f.stale }))} count={counts.stale}>stale</Chip>
          <Chip active={filters.orphaned} onClick={() => setFilters(f => ({ ...f, orphaned: !f.orphaned }))} count={counts.orphaned}>remote gone</Chip>
          <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <Chip active={showProtected} onClick={() => setShowProtected(v => !v)}>include protected</Chip>
        </div>

        {/* Column header */}
        <div style={{
          display: 'grid', gridTemplateColumns: TOKENS.listGridCols,
          alignItems: 'center', columnGap: 14,
          padding: `8px ${TOKENS.rowPx}px 8px 12px`,
          fontSize: TOKENS.fs.xs, color: 'var(--fg-subtle)', letterSpacing: '0.04em',
          borderBottom: '1px solid var(--border)',
        }}>
          <div onClick={(e) => e.stopPropagation()}>
            {selected.size > 0 && (
              <Checkbox
                checked={selected.size === filtered.filter(b => !b.isProtected).length}
                indeterminate={selected.size < filtered.filter(b => !b.isProtected).length && selected.size > 0}
                onChange={(c) => {
                  if (c) setSelected(new Set(filtered.filter(b => !b.isProtected).map(b => b.name)));
                  else setSelected(new Set());
                }}
              />
            )}
          </div>
          <span />
          <span>branch</span>
          <span style={{ textAlign: 'right' }}>pr</span>
          <span style={{ textAlign: 'right' }}>↑ ↓</span>
          <span />
        </div>

        {/* Groups */}
        <div>
          {grouped.map(group => (
            <div key={group.key}>
              {group.label && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 4px 4px' }}>
                  <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-muted)', letterSpacing: '0.02em' }}>{group.label}</span>
                  <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>{group.items.length}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}
              {group.items.map(b => (
                <BranchRow
                  key={b.name} b={b}
                  selected={selected.has(b.name)} anySelected={selected.size > 0}
                  isActive={activeBranch?.name === b.name}
                  onSelectToggle={toggleSelect}
                  onClick={onOpenDrawer} onSwitch={onSwitch}
                  authors={authors}
                />
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <Empty icon={<I.Branch size={20} />} title="No branches match" detail="Try changing your search or filters." />
          )}
        </div>
      </div>

      {/* Floating multi-select bar */}
      {selected.size > 0 && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '5px 5px 5px 12px',
          background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
          borderRadius: 8, boxShadow: 'var(--shadow-toast)',
          animation: 'slide-up 0.18s ease', zIndex: 30, fontSize: TOKENS.fs.md,
        }}>
          <span style={{ color: 'var(--fg)', marginRight: 4 }}>{selected.size} selected</span>
          <span style={{ width: 1, height: 14, background: 'var(--border)', marginRight: 4 }} />
          <ActionBarButton onClick={() => onAddToast({ title: `Pulled ${selected.size} branches` })}>pull</ActionBarButton>
          <ActionBarButton onClick={() => onAddToast({ title: `Rebased ${selected.size} branches onto main` })}>rebase</ActionBarButton>
          <ActionBarButton danger onClick={() => {
            const names = Array.from(selected);
            sendMessage('deleteMultiple', { branchNames: names });
            onAddToast({ title: `Deleted ${names.length} ${names.length === 1 ? 'branch' : 'branches'}`, detail: 'preserved in reflog · 30 day recovery', canUndo: true });
            setSelected(new Set());
          }}>delete</ActionBarButton>
          <button onClick={() => setSelected(new Set())} style={{
            width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', borderRadius: TOKENS.radius.sm,
            color: 'var(--fg-muted)', cursor: 'pointer', marginLeft: 2,
          }}><I.X size={11} /></button>
        </div>
      )}
    </div>
  );
};
