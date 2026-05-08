// Compare view — branch A vs branch B.

import React, { useState, useEffect } from 'react';
import { RepoBranch, CompareResult, ToastData } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage, onMessage } from '../bridge';
import { Button, IconButton, Badge } from '../components';
import * as I from '../icons';

interface CompareViewProps {
  branches: RepoBranch[];
  currentBranch: string;
  defaultBranch: string;
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
}

const BranchPicker: React.FC<{
  label: string;
  branches: string[];
  value: string;
  onChange: (v: string) => void;
}> = ({ label, branches, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', height: 40, padding: '0 12px', background: 'transparent',
        border: 'none', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer', fontFamily: 'inherit', color: 'var(--fg-strong)', textAlign: 'left',
      }}>
        <I.Branch size={14} style={{ color: 'var(--fg-muted)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: TOKENS.fs.xs, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.base + 0.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
        <I.ChevronDown size={12} style={{ color: 'var(--fg-muted)' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 0, top: 'calc(100% + 4px)',
          minWidth: 280, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
          borderRadius: 8, padding: 4, boxShadow: 'var(--shadow-popover)', zIndex: 40,
        }}>
          {branches.map(b => (
            <button key={b} onClick={() => { onChange(b); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
                background: b === value ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--fg)', border: 'none', borderRadius: 5,
                fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.md, cursor: 'pointer', textAlign: 'left',
              }}>
              <I.Branch size={11} style={{ color: 'var(--fg-muted)' }} />
              {b}
              {b === value && <I.Check size={11} style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CommitRow: React.FC<{ commit: CompareResult['ahead'][0]; side: 'ahead' | 'behind' }> = ({ commit, side }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 4,
  }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: side === 'ahead' ? 'var(--healthy)' : 'var(--warning)', flexShrink: 0 }} />
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-subtle)' }}>{commit.hash}</span>
    <span style={{ flex: 1, fontSize: TOKENS.fs.base + 0.5, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.message}</span>
    <span style={{ fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-muted)', minWidth: 50, textAlign: 'right' }}>{commit.date}</span>
  </div>
);

const STATUS_TONES: Record<string, string> = { A: 'var(--healthy)', M: 'var(--warning)', D: 'var(--danger)', R: 'var(--info)' };
const STATUS_LABELS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };

const FileRow: React.FC<{ f: CompareResult['files'][0]; isLast: boolean }> = ({ f, isLast }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px',
    borderBottom: isLast ? 'none' : '1px solid var(--border)',
  }}>
    <span style={{
      width: 18, height: 18, borderRadius: 4,
      background: STATUS_TONES[f.status] + '22', color: STATUS_TONES[f.status],
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: TOKENS.fs.xs, fontWeight: 700, fontFamily: 'var(--font-mono)',
    }}>{f.status}</span>
    <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.md, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
    <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-muted)' }}>{STATUS_LABELS[f.status]}</span>
    <span style={{ display: 'flex', gap: 6, fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.sm, fontVariantNumeric: 'tabular-nums', minWidth: 90, justifyContent: 'flex-end' }}>
      {f.additions > 0 && <span style={{ color: 'var(--healthy)' }}>+{f.additions}</span>}
      {f.deletions > 0 && <span style={{ color: 'var(--danger)' }}>−{f.deletions}</span>}
    </span>
    <IconButton size={24} label="Open"><I.Eye size={12} /></IconButton>
  </div>
);

export const CompareView: React.FC<CompareViewProps> = ({ branches, currentBranch, defaultBranch, onAddToast }) => {
  const [branchA, setBranchA] = useState(currentBranch);
  const [branchB, setBranchB] = useState(defaultBranch);
  const [tab, setTab] = useState<'commits' | 'files'>('commits');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);

  const allBranches = branches.map(b => b.name);

  useEffect(() => {
    return onMessage((msg) => {
      if (msg.command === 'comparisonResult' && msg.data) {
        setResult(msg.data as CompareResult);
        setLoading(false);
      }
    });
  }, []);

  const doCompare = () => {
    setLoading(true);
    sendMessage('compareBranches', { branchA, branchB });
  };

  const totalAdds = result?.files.reduce((s, f) => s + f.additions, 0) ?? 0;
  const totalDels = result?.files.reduce((s, f) => s + f.deletions, 0) ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: `12px ${TOKENS.sectionPx}px`, borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: TOKENS.fs.body, fontWeight: 500, color: 'var(--fg-strong)' }}>Compare</div>
        <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', marginTop: 1 }}>See what's different between two branches</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: `${TOKENS.contentPy}px ${TOKENS.sectionPx}px` }}>
        {/* Branch pickers */}
        <div style={{
          display: 'flex', alignItems: 'stretch', gap: 0,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: TOKENS.radius.lg, padding: 4, marginBottom: 14,
        }}>
          <BranchPicker label="Base" branches={allBranches} value={branchB} onChange={setBranchB} />
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', color: 'var(--fg-muted)' }}>
            <I.ArrowRight size={14} />
          </div>
          <BranchPicker label="Compare" branches={allBranches} value={branchA} onChange={setBranchA} />
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
            {result && (
              <>
                <Badge tone="healthy">{result.ahead.length} ahead</Badge>
                <Badge tone="warning">{result.behind.length} behind</Badge>
              </>
            )}
            <Button variant="primary" size="md" onClick={doCompare}
                    style={{ opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Comparing…' : 'Compare'}
            </Button>
          </div>
        </div>

        {/* Diff stats */}
        {result && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', marginBottom: 14,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: TOKENS.radius.lg,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg-strong)', fontVariantNumeric: 'tabular-nums' }}>{result.files.length}</span>
                <span style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)' }}>files changed</span>
              </div>
              <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.body, color: 'var(--healthy)', fontWeight: 500 }}>+{totalAdds.toLocaleString()}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.body, color: 'var(--danger)', fontWeight: 500 }}>−{totalDels.toLocaleString()}</span>
              </div>
              {(totalAdds + totalDels) > 0 && (
                <>
                  <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
                  <div style={{ flex: 1, maxWidth: 240, height: 4, background: 'var(--bg-raised)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${(totalAdds / (totalAdds + totalDels)) * 100}%`, background: 'var(--healthy)' }} />
                    <div style={{ width: `${(totalDels / (totalAdds + totalDels)) * 100}%`, background: 'var(--danger)' }} />
                  </div>
                </>
              )}
              <Button variant="primary" size="md" icon={<I.GitMerge size={12} />}
                      onClick={() => onAddToast({ title: `Merged ${branchA} into ${branchB}` })}>
                Merge into {branchB}
              </Button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
              {[{ key: 'commits' as const, label: 'Commits', count: result.ahead.length }, { key: 'files' as const, label: 'Files', count: result.files.length }].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  background: 'transparent', border: 'none', padding: '10px 12px',
                  color: tab === t.key ? 'var(--fg-strong)' : 'var(--fg-muted)',
                  borderBottom: `2px solid ${tab === t.key ? 'var(--accent)' : 'transparent'}`,
                  fontSize: TOKENS.fs.base + 0.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1,
                }}>
                  {t.label}<span style={{ marginLeft: 6, color: 'var(--fg-subtle)', fontSize: TOKENS.fs.sm + 0.5 }}>{t.count}</span>
                </button>
              ))}
            </div>

            {tab === 'commits' && (
              <div>
                <div style={{ fontSize: TOKENS.fs.sm, fontWeight: 600, color: 'var(--healthy)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 4px 6px' }}>Only in {branchA}</div>
                {result.ahead.map((c, i) => <CommitRow key={i} commit={c} side="ahead" />)}
                <div style={{ fontSize: TOKENS.fs.sm, fontWeight: 600, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '16px 4px 6px' }}>Only in {branchB}</div>
                {result.behind.map((c, i) => <CommitRow key={i} commit={c} side="behind" />)}
              </div>
            )}

            {tab === 'files' && (
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: TOKENS.radius.lg, overflow: 'hidden', marginTop: 8 }}>
                {result.files.map((f, i) => <FileRow key={i} f={f} isLast={i === result.files.length - 1} />)}
              </div>
            )}
          </>
        )}

        {!result && !loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: TOKENS.fs.body }}>
            Select two branches and click Compare.
          </div>
        )}
      </div>
    </div>
  );
};
