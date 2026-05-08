// Tools view — cleanup rules, settings, templates, recovery log.

import React, { useState } from 'react';
import { CleanupRule, RecoveryEntry, ToastData } from '../types';
import { TOKENS } from '../tokens';
import { sendMessage } from '../bridge';
import { Button, IconButton, Badge, Toggle, StatRow } from '../components';
import * as I from '../icons';

interface ToolsViewProps {
  cleanupRules: CleanupRule[];
  recoveryLog: RecoveryEntry[];
  protectedBranches: string[];
  staleDays: number;
  onAddToast: (t: Omit<ToastData, 'id'>) => void;
}

const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div style={{
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: TOKENS.radius.lg, padding: '14px 16px', marginBottom: 12,
  }}>
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: TOKENS.fs.base, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', marginTop: 2 }}>{subtitle}</div>}
    </div>
    {children}
  </div>
);

const Row: React.FC<{ label: React.ReactNode; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 0', gap: 14, borderTop: '1px solid var(--border)',
  }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: TOKENS.fs.md + 0.5, color: 'var(--fg)' }}>{label}</div>
      {hint && <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-subtle)', marginTop: 1 }}>{hint}</div>}
    </div>
    {children}
  </div>
);

const TABS = [
  { key: 'rules',     label: 'Cleanup rules' },
  { key: 'settings',  label: 'Settings' },
  { key: 'templates', label: 'Branch templates' },
  { key: 'history',   label: 'Recovery log' },
] as const;
type TabKey = typeof TABS[number]['key'];

const TEMPLATES = [
  { pattern: 'feature/{ticket}-{description}', color: 'var(--healthy)',  example: 'feature/ABC-123-add-login' },
  { pattern: 'bugfix/{ticket}-{description}',  color: 'var(--danger)',   example: 'bugfix/ABC-456-fix-crash' },
  { pattern: 'hotfix/{version}-{description}', color: '#f97316',         example: 'hotfix/2.1.1-security-patch' },
  { pattern: 'refactor/{description}',         color: 'var(--info)',     example: 'refactor/extract-auth-hook' },
  { pattern: 'chore/{description}',            color: 'var(--fg-muted)', example: 'chore/update-dependencies' },
];

export const ToolsView: React.FC<ToolsViewProps> = ({
  cleanupRules: initialRules,
  recoveryLog,
  protectedBranches: initialProtected,
  staleDays: initialStaleDays,
  onAddToast,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('rules');
  const [rules, setRules] = useState(initialRules);
  const [staleDays, setStaleDays] = useState(initialStaleDays);
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [showNotifications, setShowNotifications] = useState(true);
  const [protectedBranches, setProtectedBranches] = useState(initialProtected);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: `12px ${TOKENS.sectionPx}px`, borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: TOKENS.fs.body, fontWeight: 500, color: 'var(--fg-strong)' }}>Tools</div>
        <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', marginTop: 1 }}>Cleanup rules, settings, recovery, and templates</div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sub-nav */}
        <div style={{ width: 200, borderRight: '1px solid var(--border)', padding: '12px 8px', flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '7px 10px', marginBottom: 1,
              background: activeTab === t.key ? 'var(--bg-hover)' : 'transparent',
              color: activeTab === t.key ? 'var(--fg-strong)' : 'var(--fg-muted)',
              border: 'none', borderRadius: 5,
              fontSize: TOKENS.fs.md + 0.5, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: `${TOKENS.contentPy}px ${TOKENS.sectionPx}px` }}>
          {activeTab === 'rules' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: TOKENS.fs.body + 0.5, fontWeight: 500 }}>Auto-cleanup rules</div>
                  <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', marginTop: 1 }}>Keep your repo tidy automatically — runs on every fetch</div>
                </div>
                <Button variant="secondary" size="md" icon={<I.Plus size={12} />}>New rule</Button>
              </div>
              {rules.map(r => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 14px', marginBottom: 6,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: TOKENS.radius.md,
                }}>
                  <Toggle
                    on={r.enabled}
                    onChange={(v) => {
                      const updated = rules.map(x => x.id === r.id ? { ...x, enabled: v } : x);
                      setRules(updated);
                      sendMessage('saveCleanupRules', { rules: updated });
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: TOKENS.fs.base, color: r.enabled ? 'var(--fg-strong)' : 'var(--fg-muted)' }}>{r.name}</div>
                    <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-subtle)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                      {[
                        r.conditions.merged && 'merged',
                        r.conditions.olderThanDays && `>${r.conditions.olderThanDays}d old`,
                        r.conditions.pattern,
                        r.conditions.noRemote && 'no remote',
                      ].filter(Boolean).join(' · ')}
                      <span style={{ color: 'var(--fg-faint)' }}>{' → '}</span>
                      <span style={{ color: r.action === 'delete' ? 'var(--danger)' : r.action === 'archive' ? 'var(--info)' : 'var(--warning)' }}>{r.action}</span>
                    </div>
                  </div>
                  <IconButton size={26} label="Edit"><I.Edit size={11} /></IconButton>
                  <IconButton size={26} label="Delete"><I.Trash size={11} /></IconButton>
                </div>
              ))}
            </>
          )}

          {activeTab === 'settings' && (
            <Card title="Branch detection" subtitle="How the extension classifies your branches">
              <Row label="Days until stale" hint="Branches older than this are flagged for review">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min="7" max="90" value={staleDays}
                    onChange={(e) => setStaleDays(Number(e.target.value))}
                    style={{ width: 120, accentColor: 'var(--accent)' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.md, color: 'var(--fg-strong)', fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'right' }}>
                    {staleDays} days
                  </span>
                </div>
              </Row>
              <Row label="Confirm before delete" hint="Show a dialog before removing branches">
                <Toggle on={confirmDelete} onChange={setConfirmDelete} />
              </Row>
              <Row label="Show notifications" hint="Notify when branches need cleanup">
                <Toggle on={showNotifications} onChange={setShowNotifications} />
              </Row>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: TOKENS.fs.md + 0.5, color: 'var(--fg)', marginBottom: 8 }}>Protected branches</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {protectedBranches.map(b => (
                    <div key={b} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 6px', background: 'var(--bg-raised)',
                      border: '1px solid var(--border-strong)', borderRadius: TOKENS.radius.sm,
                      fontSize: TOKENS.fs.sm, fontFamily: 'var(--font-mono)',
                    }}>
                      <I.Shield size={9} style={{ color: 'var(--fg-muted)' }} />
                      {b}
                      <button
                        onClick={() => setProtectedBranches(protectedBranches.filter(x => x !== b))}
                        style={{ background: 'transparent', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                        <I.X size={10} />
                      </button>
                    </div>
                  ))}
                  <button style={{
                    background: 'transparent', border: '1px dashed var(--border-strong)',
                    color: 'var(--fg-muted)', padding: '2px 8px',
                    borderRadius: TOKENS.radius.sm, fontSize: TOKENS.fs.sm, fontFamily: 'inherit',
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                    <I.Plus size={9} /> Add
                  </button>
                </div>
                <div style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)' }}>These branches can never be deleted by the extension.</div>
              </div>
            </Card>
          )}

          {activeTab === 'templates' && (
            <Card title="Branch naming templates" subtitle="Create branches with consistent naming conventions">
              {TEMPLATES.map((t, i) => (
                <Row key={t.pattern} label={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.md }}>{t.pattern}</span>
                  </div>
                } hint={`example: ${t.example}`}>
                  <Button size="sm" variant="ghost" icon={<I.Plus size={11} />}>Use</Button>
                </Row>
              ))}
            </Card>
          )}

          {activeTab === 'history' && (
            <Card title="Deleted branches" subtitle="Recover branches you deleted in the last 30 days">
              {recoveryLog.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--fg-muted)', fontSize: TOKENS.fs.body }}>
                  No deleted branches in the last 30 days.
                </div>
              ) : recoveryLog.map((r, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: 'rgba(244,63,94,0.1)', color: 'var(--danger)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <I.Trash size={13} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.md + 0.5, color: 'var(--fg-strong)' }}>{r.branchName}</div>
                    <div style={{ fontSize: TOKENS.fs.md, color: 'var(--fg-muted)', marginTop: 2 }}>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{r.commitHash}</span>
                      {' · '}deleted {r.deletedAt} by {r.deletedBy}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" icon={<I.Undo size={11} />}
                    onClick={() => {
                      sendMessage('restoreBranch', { branchName: r.branchName, commitHash: r.commitHash });
                      onAddToast({ title: `Restored ${r.branchName}`, detail: 'branch recreated at original commit' });
                    }}>
                    Restore
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
