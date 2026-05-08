// Root app — shell, sidebar, topbar, view router, drawer, toasts, palette.

import React, { useState, useEffect } from 'react';
import { InitialData, RepoBranch, ToastData, CompareResult } from './types';
import { TOKENS } from './tokens';
import { onMessage, sendMessage } from './bridge';
import { IconButton, Toast, Kbd } from './components';
import * as I from './icons';
import { LocalView } from './views/local';
import { Drawer } from './views/drawer';
import { RemoteView } from './views/remote';
import { WorktreesView } from './views/worktrees';
import { StashesView } from './views/stashes';
import { CompareView } from './views/compare';
import { ToolsView } from './views/tools';
import { Palette } from './views/palette';

type ViewKey = 'local' | 'remote' | 'worktrees' | 'stashes' | 'compare' | 'tools';

const EMPTY_INITIAL_DATA: InitialData = {
  repo: { name: '', path: '', currentBranch: '', remote: 'origin', remoteUrl: '', defaultBranch: 'main', protectedBranches: [], staleDays: 30 },
  authors: {},
  branches: [],
  remoteBranches: [],
  worktrees: [],
  stashes: [],
  cleanupRules: [],
  recoveryLog: [],
};

export const App: React.FC = () => {
  const data = window.INITIAL_DATA ?? EMPTY_INITIAL_DATA;

  const [view, setView] = useState<ViewKey>('local');
  const [drawerBranch, setDrawerBranch] = useState<RepoBranch | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(data.theme ?? 'dark');
  const [branches, setBranches] = useState(data.branches);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    return onMessage((msg) => {
      if (msg.command === 'prStatusUpdate' && msg.data) {
        const { branchName, pr } = msg.data as { branchName: string; pr: RepoBranch['pr'] };
        setBranches(bs => bs.map(b => b.name === branchName ? { ...b, pr } : b));
      }
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const addToast = (t: Omit<ToastData, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { id, ...t }]);
  };
  const dismissToast = (id: number) => setToasts(ts => ts.filter(t => t.id !== id));

  const navItems: { key: ViewKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'local',     label: 'Local',     icon: <I.Branch size={15} />, count: branches.filter(b => !b.isProtected).length },
    { key: 'remote',    label: 'Remote',    icon: <I.Cloud size={15} />,  count: data.remoteBranches.length },
    { key: 'worktrees', label: 'Worktrees', icon: <I.Tree size={15} />,   count: data.worktrees.length },
    { key: 'stashes',   label: 'Stashes',   icon: <I.Stash size={15} />,  count: data.stashes.length },
    { key: 'compare',   label: 'Compare',   icon: <I.Compare size={15} /> },
    { key: 'tools',     label: 'Tools',     icon: <I.Wrench size={15} /> },
  ];

  const currentBranch = branches.find(b => b.isCurrent)?.name ?? data.repo.currentBranch;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Topbar */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px', height: 44,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.md + 0.5, color: 'var(--fg-strong)', fontWeight: 500 }}>
            {data.repo.name}
          </span>
          <span style={{ color: 'var(--fg-faint)' }}>·</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.md, color: 'var(--fg-muted)' }}>
            {currentBranch}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <button onClick={() => setPaletteOpen(true)} className="focus-ring" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 28, padding: '0 8px 0 10px',
          background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
          borderRadius: 6, color: 'var(--fg-muted)',
          fontSize: TOKENS.fs.md, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          <I.Search size={12} />
          <span>Search or run command…</span>
          <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
          <Kbd>⌘</Kbd><Kbd>K</Kbd>
        </button>

        <button
          onClick={() => sendMessage('openSponsor')}
          className="focus-ring"
          title="Sponsor on GitHub"
          aria-label="Sponsor on GitHub"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 28, padding: '0 10px',
            background: 'var(--accent-soft)',
            border: '1px solid transparent',
            borderRadius: 6,
            color: 'var(--accent)',
            fontSize: TOKENS.fs.md, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
            whiteSpace: 'nowrap', flexShrink: 0,
            transition: 'background 0.12s',
          }}
        >
          <I.Heart size={12} />
          <span>Sponsor</span>
        </button>

        <div style={{ display: 'flex', gap: 2 }}>
          <IconButton size={28} label="Toggle theme"
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark';
              setTheme(next);
              sendMessage('setTheme', { theme: next });
            }}>
            {theme === 'dark' ? <I.Sun size={14} /> : <I.Moon size={14} />}
          </IconButton>
          <IconButton size={28} label="Settings" onClick={() => setView('tools')}>
            <I.Settings size={14} />
          </IconButton>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <nav style={{
          width: 184, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: '10px 8px',
          display: 'flex', flexDirection: 'column',
        }}>
          {navItems.map(item => (
            <button key={item.key} onClick={() => setView(item.key)} className="focus-ring" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', marginBottom: 1,
              background: view === item.key ? 'var(--bg-hover)' : 'transparent',
              color: view === item.key ? 'var(--fg-strong)' : 'var(--fg-muted)',
              border: 'none', borderRadius: 6,
              fontSize: TOKENS.fs.base, fontFamily: 'inherit', fontWeight: view === item.key ? 500 : 400,
              cursor: 'pointer', textAlign: 'left',
              transition: 'background 0.1s, color 0.1s',
              position: 'relative',
            }}>
              {view === item.key && (
                <span style={{
                  position: 'absolute', left: -8, top: 9, bottom: 9, width: 2,
                  background: 'var(--accent)', borderRadius: 2,
                }} />
              )}
              <span style={{ color: view === item.key ? 'var(--accent)' : 'currentColor' }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.count !== undefined && (
                <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                  {item.count}
                </span>
              )}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          <div style={{ borderTop: '1px solid var(--border)' }}>
            <div style={{
              padding: '10px 10px 6px',
              fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Kbd>⌘</Kbd><Kbd>K</Kbd>
              <span>command palette</span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 2,
              padding: '0 6px 8px',
            }}>
              <IconButton size={26} label="Buy Me a Coffee" onClick={() => sendMessage('openSupport')}>
                <I.Coffee size={13} />
              </IconButton>
              <IconButton size={26} label="Report an issue on GitHub" onClick={() => sendMessage('openGithub')}>
                <I.Github size={13} />
              </IconButton>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg)' }}>
          {view === 'local' && (
            <LocalView
              branches={branches}
              authors={data.authors}
              onOpenDrawer={setDrawerBranch}
              onAddToast={addToast}
            />
          )}
          {view === 'remote' && (
            <RemoteView
              remoteBranches={data.remoteBranches}
              repo={data.repo}
              authors={data.authors}
              onAddToast={addToast}
            />
          )}
          {view === 'worktrees' && (
            <WorktreesView
              worktrees={data.worktrees}
              onAddToast={addToast}
            />
          )}
          {view === 'stashes' && (
            <StashesView
              stashes={data.stashes}
              onAddToast={addToast}
            />
          )}
          {view === 'compare' && (
            <CompareView
              branches={branches}
              currentBranch={currentBranch}
              defaultBranch={data.repo.defaultBranch}
              onAddToast={addToast}
            />
          )}
          {view === 'tools' && (
            <ToolsView
              cleanupRules={data.cleanupRules}
              recoveryLog={data.recoveryLog}
              protectedBranches={data.repo.protectedBranches}
              staleDays={data.repo.staleDays}
              onAddToast={addToast}
            />
          )}

          {drawerBranch && (
            <Drawer
              branch={drawerBranch}
              authors={data.authors}
              compareCommits={{ ahead: [], behind: [], files: [] }}
              onClose={() => setDrawerBranch(null)}
              onAddToast={addToast}
            />
          )}
        </main>
      </div>

      {/* Toast stack */}
      <div style={{
        position: 'fixed', right: 24, bottom: 24,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 200, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <Toast toast={t} onDismiss={dismissToast} />
          </div>
        ))}
      </div>

      {/* Command palette */}
      <Palette
        open={paletteOpen}
        branches={branches}
        onClose={() => setPaletteOpen(false)}
        onAddToast={addToast}
      />
    </div>
  );
};
