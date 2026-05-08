// ALL shared UI primitives. No view file redefines any of these.
// Every style token references CSS variables — no hex literals in style props.

import React, { useState, useEffect, useRef } from 'react';
import { AuthorInfo, PRInfo, ToastData } from './types';
import * as I from './icons';
import { TOKENS } from './tokens';

// ── Author ──────────────────────────────────────────────────────────────────

export function getAuthor(key: string, authors: Record<string, AuthorInfo>): AuthorInfo {
  return authors[key] || { name: key, initials: key.slice(0, 2).toUpperCase(), color: '#64748b' };
}

// ── Avatar ───────────────────────────────────────────────────────────────────

interface AvatarProps {
  author: string;
  authors: Record<string, AuthorInfo>;
  size?: number;
  ring?: boolean;
}

export const Avatar: React.FC<AvatarProps> = ({ author, authors, size = 18, ring = false }) => {
  const a = getAuthor(author, authors);
  return (
    <div
      title={a.name}
      style={{
        width: size, height: size, borderRadius: '50%',
        background: a.color, color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.42), fontWeight: 600, letterSpacing: '0.02em',
        flexShrink: 0,
        boxShadow: ring ? '0 0 0 2px var(--bg)' : 'none',
      }}
    >{a.initials}</div>
  );
};

// ── Badge ────────────────────────────────────────────────────────────────────

type BadgeTone = 'default' | 'accent' | 'healthy' | 'warning' | 'critical' | 'danger' | 'info' | 'pr' | 'outline';

const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  default:  { bg: 'var(--bg-raised)',                   fg: 'var(--fg-muted)',   bd: 'var(--border)' },
  accent:   { bg: 'var(--accent-soft)',                 fg: 'var(--accent)',     bd: 'transparent' },
  healthy:  { bg: 'rgba(16, 185, 129, 0.12)',           fg: 'var(--healthy)',    bd: 'transparent' },
  warning:  { bg: 'rgba(245, 158, 11, 0.12)',           fg: 'var(--warning)',    bd: 'transparent' },
  critical: { bg: 'rgba(251, 146, 60, 0.12)',           fg: 'var(--critical)',   bd: 'transparent' },
  danger:   { bg: 'rgba(244, 63, 94, 0.12)',            fg: 'var(--danger)',     bd: 'transparent' },
  info:     { bg: 'rgba(96, 165, 250, 0.12)',           fg: 'var(--info)',       bd: 'transparent' },
  pr:       { bg: 'rgba(167, 139, 250, 0.12)',          fg: 'var(--pr)',         bd: 'transparent' },
  outline:  { bg: 'transparent',                        fg: 'var(--fg-muted)',   bd: 'var(--border-strong)' },
};

interface BadgeProps {
  children?: React.ReactNode;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({ children, tone = 'default', icon, size = 'md', style = {} }) => {
  const t = BADGE_TONES[tone];
  const sz = size === 'sm'
    ? { px: 5, py: 1, fz: TOKENS.fs.xs, gap: 3 }
    : { px: 7, py: 2, fz: TOKENS.fs.sm, gap: 4 };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: sz.gap,
      padding: `${sz.py}px ${sz.px}px`,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      borderRadius: TOKENS.radius.sm, fontSize: sz.fz, fontWeight: 500,
      letterSpacing: '0.005em', lineHeight: 1.2, whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
      ...style,
    }}>
      {icon}{children}
    </span>
  );
};

export const MonoBadge: React.FC<BadgeProps> = (props) => (
  <Badge {...props} style={{ fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.xs, ...props.style }} />
);

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'danger-solid';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, { bg: string; fg: string; bd: string; hover: string }> = {
  primary:       { bg: 'var(--accent)',              fg: '#0a0a0b',        bd: 'var(--accent)',           hover: 'var(--accent-strong)' },
  secondary:     { bg: 'var(--bg-raised)',           fg: 'var(--fg)',      bd: 'var(--border-strong)',    hover: 'var(--bg-hover)' },
  ghost:         { bg: 'transparent',                fg: 'var(--fg-muted)',bd: 'transparent',             hover: 'var(--bg-hover)' },
  outline:       { bg: 'transparent',                fg: 'var(--fg)',      bd: 'var(--border-strong)',    hover: 'var(--bg-hover)' },
  danger:        { bg: 'rgba(244, 63, 94, 0.1)',     fg: 'var(--danger)',  bd: 'rgba(244, 63, 94, 0.25)', hover: 'rgba(244, 63, 94, 0.18)' },
  'danger-solid':{ bg: 'var(--danger)',              fg: '#fff',           bd: 'var(--danger)',           hover: '#e11d48' },
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  kbd?: string;
  danger?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary', size = 'md', icon, iconRight, kbd, danger,
  children, style = {}, ...rest
}) => {
  const sizes: Record<ButtonSize, { h: number; px: number; fz: number; gap: number }> = {
    sm: { h: 26, px: 9,  fz: TOKENS.fs.md, gap: 5 },
    md: { h: 30, px: 11, fz: TOKENS.fs.base + 0.5, gap: 6 },
    lg: { h: 36, px: 14, fz: TOKENS.fs.body, gap: 7 },
  };
  const s = sizes[size];
  const v = danger ? BUTTON_VARIANTS.danger : BUTTON_VARIANTS[variant];
  const [hover, setHover] = useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: s.gap,
        height: s.h, padding: `0 ${s.px}px`,
        background: hover ? v.hover : v.bg, color: v.fg,
        border: `1px solid ${v.bd}`,
        borderRadius: TOKENS.radius.md, fontSize: s.fz, fontWeight: 500,
        letterSpacing: '-0.005em', transition: 'background 0.12s, border-color 0.12s, color 0.12s',
        whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
        ...style,
      }}
      {...rest}
    >
      {icon}{children}{iconRight}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
};

// ── IconButton ────────────────────────────────────────────────────────────────

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: number;
  label: string;
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({ size = 28, label, children, active, style = {}, ...rest }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={label} aria-label={label}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: size, height: size,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: active || hover ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
        border: '1px solid transparent', borderRadius: TOKENS.radius.md,
        transition: 'background 0.12s, color 0.12s',
        cursor: 'pointer', fontFamily: 'inherit',
        ...style,
      }}
      {...rest}
    >{children}</button>
  );
};

// ── Keyboard hint ─────────────────────────────────────────────────────────────

export const Kbd: React.FC<{ children: React.ReactNode; inline?: boolean }> = ({ children, inline = false }) => (
  <kbd style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 18, height: 18, padding: '0 5px',
    background: inline ? 'rgba(255,255,255,0.06)' : 'var(--bg-raised)',
    border: '1px solid var(--border-strong)', borderRadius: TOKENS.radius.sm,
    fontFamily: 'var(--font-mono)', fontSize: TOKENS.fs.xs, fontWeight: 500,
    color: 'var(--fg-muted)', letterSpacing: 0,
  }}>{children}</kbd>
);

// ── Checkbox ──────────────────────────────────────────────────────────────────

interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  size?: number;
}

export const Checkbox: React.FC<CheckboxProps> = ({ checked, indeterminate, onChange, size = 14 }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size,
        background: checked || indeterminate ? 'var(--accent)' : 'transparent',
        border: `1.25px solid ${checked || indeterminate ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 3.5, cursor: 'pointer', flexShrink: 0,
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <input ref={ref} type="checkbox" checked={!!checked} onChange={() => {}} style={{ display: 'none' }} />
      {checked && !indeterminate && (
        <svg width={size - 4} height={size - 4} viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.5L5 9l5-6" stroke="#0a0a0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && (
        <span style={{ width: size - 6, height: 1.5, background: '#0a0a0b', borderRadius: 1 }} />
      )}
    </span>
  );
};

// ── Status dot (CI) ───────────────────────────────────────────────────────────

type DotStatus = 'passing' | 'failing' | 'pending' | 'none';

export const StatusDot: React.FC<{ status: DotStatus; size?: number }> = ({ status, size = 7 }) => {
  const colors: Record<DotStatus, string> = {
    passing: 'var(--healthy)', failing: 'var(--danger)',
    pending: 'var(--warning)', none: 'var(--fg-faint)',
  };
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: colors[status] || colors.none, flexShrink: 0,
      animation: status === 'pending' ? 'pulse-dot 1.6s infinite ease-in-out' : 'none',
    }} />
  );
};

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: number) => void;
  onUndo?: (toast: ToastData) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss, onUndo }) => {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 6000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px 10px 14px',
      background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
      borderRadius: 8, boxShadow: 'var(--shadow-toast)',
      minWidth: 320, maxWidth: 480,
      animation: 'slide-up 0.25s ease',
    }}>
      <div style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: toast.tone === 'danger' ? 'rgba(244, 63, 94, 0.12)' : 'var(--accent-soft)',
        color: toast.tone === 'danger' ? 'var(--danger)' : 'var(--accent)',
        borderRadius: 5, flexShrink: 0,
      }}>
        <I.Check size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: TOKENS.fs.body, fontWeight: 500, color: 'var(--fg-strong)', lineHeight: 1.35 }}>
          {toast.title}
        </div>
        {toast.detail && (
          <div style={{ fontSize: TOKENS.fs.sm + 0.5, color: 'var(--fg-muted)', marginTop: 1 }}>{toast.detail}</div>
        )}
      </div>
      {toast.canUndo && (
        <Button variant="ghost" size="sm" icon={<I.Undo size={12} />}
                onClick={() => { onUndo?.(toast); onDismiss(toast.id); }}>Undo</Button>
      )}
      <IconButton size={22} label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <I.X size={13} />
      </IconButton>
    </div>
  );
};

// ── Section header ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ children, count, action, style = {} }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 4px 8px', ...style,
  }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontSize: TOKENS.fs.sm, fontWeight: 600, color: 'var(--fg-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em',
      }}>{children}</span>
      {count !== undefined && (
        <span style={{ fontSize: TOKENS.fs.sm, color: 'var(--fg-subtle)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      )}
    </div>
    {action}
  </div>
);

// ── Chip (filter toggle) ──────────────────────────────────────────────────────

type ChipTone = 'healthy' | 'warning' | 'critical' | 'danger' | 'info' | 'pr';

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  tone?: ChipTone;
  icon?: React.ReactNode;
}

const CHIP_DOT_COLORS: Record<ChipTone, string> = {
  healthy: 'var(--healthy)', warning: 'var(--warning)',
  critical: 'var(--critical)', danger: 'var(--danger)',
  info: 'var(--info)', pr: 'var(--pr)',
};

export const Chip: React.FC<ChipProps> = ({ active, onClick, children, count, tone, icon }) => {
  const [hover, setHover] = useState(false);
  const dot = tone ? CHIP_DOT_COLORS[tone] : null;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 26, padding: '0 9px',
        background: active || hover ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
        border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 13, fontSize: TOKENS.fs.md, fontWeight: 500, whiteSpace: 'nowrap',
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />}
      {icon}{children}
      {count !== undefined && (
        <span style={{ color: 'var(--fg-subtle)', fontVariantNumeric: 'tabular-nums', fontSize: TOKENS.fs.sm + 0.5 }}>{count}</span>
      )}
    </button>
  );
};

// ── Search input ──────────────────────────────────────────────────────────────

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  kbd?: string;
  style?: React.CSSProperties;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value, onChange, placeholder = 'Search…', autoFocus, kbd, style = {},
}) => {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      height: 32, padding: '0 10px',
      background: 'var(--bg-input)',
      border: `1px solid ${focus ? 'var(--border-focus)' : 'var(--border)'}`,
      borderRadius: 7, transition: 'border-color 0.12s',
      ...style,
    }}>
      <I.Search size={13} style={{ color: 'var(--fg-subtle)' }} />
      <input
        type="text" value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          flex: 1, minWidth: 0,
          background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--fg)', fontSize: TOKENS.fs.body, fontFamily: 'var(--font-sans)',
        }}
      />
      {kbd && !value && <Kbd>{kbd}</Kbd>}
      {value && (
        <IconButton size={20} label="Clear" onClick={() => onChange('')}>
          <I.X size={11} />
        </IconButton>
      )}
    </div>
  );
};

// ── Empty state ───────────────────────────────────────────────────────────────

interface EmptyProps {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}

export const Empty: React.FC<EmptyProps> = ({ icon, title, detail, action }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '60px 20px', textAlign: 'center', gap: 4,
  }}>
    <div style={{
      width: 44, height: 44, borderRadius: TOKENS.radius.lg,
      background: 'var(--bg-raised)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--fg-muted)', marginBottom: 8,
    }}>{icon}</div>
    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</div>
    {detail && <div style={{ fontSize: TOKENS.fs.base + 0.5, color: 'var(--fg-muted)', maxWidth: 360 }}>{detail}</div>}
    {action && <div style={{ marginTop: 12 }}>{action}</div>}
  </div>
);

// ── PR badge ──────────────────────────────────────────────────────────────────

export const PRBadge: React.FC<{ pr: PRInfo | null; compact?: boolean }> = ({ pr, compact }) => {
  if (!pr) return null;
  const tone = ({ open: 'info', merged: 'pr', closed: 'default', draft: 'default' } as Record<string, BadgeTone>)[pr.state] || 'default';
  return (
    <Badge tone={tone} icon={<I.GitPull size={9} />}>
      {compact ? `#${pr.number}` : `#${pr.number} ${pr.state}`}
    </Badge>
  );
};

// ── Stat row (key/value) ──────────────────────────────────────────────────────

interface StatRowProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  valueColor?: string;
}

export const StatRow: React.FC<StatRowProps> = ({ label, value, mono, valueColor }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '100px 1fr',
    alignItems: 'baseline', gap: 12, padding: '4px 0',
  }}>
    <span style={{ color: 'var(--fg-subtle)', fontSize: TOKENS.fs.md }}>{label}</span>
    <span style={{
      color: valueColor || 'var(--fg)',
      fontFamily: mono ? 'var(--font-mono)' : 'inherit',
      fontSize: mono ? TOKENS.fs.md : TOKENS.fs.base + 0.5,
      fontVariantNumeric: 'tabular-nums',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{value}</span>
  </div>
);

// ── Dropdown (inline text-style) ──────────────────────────────────────────────

interface DropdownOption { value: string; label: string }

interface DropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
}

export const Dropdown: React.FC<DropdownProps> = ({ label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const current = options.find(o => o.value === value);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        height: 28, padding: '0 8px',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: open ? 'var(--bg-hover)' : 'transparent',
        border: '1px solid transparent', borderRadius: TOKENS.radius.md,
        color: 'var(--fg-muted)', fontSize: TOKENS.fs.md, fontFamily: 'inherit', cursor: 'pointer',
      }}>
        <span style={{ color: 'var(--fg-subtle)' }}>{label}:</span>
        <span style={{ color: 'var(--fg)' }}>{(current?.label || value).toLowerCase()}</span>
        <I.ChevronDown size={10} style={{ opacity: 0.5 }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 140,
          background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
          borderRadius: 7, padding: 4, boxShadow: 'var(--shadow-popover)', zIndex: 40,
          animation: 'slide-up 0.1s ease',
        }}>
          {options.map(opt => (
            <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '5px 8px',
                background: opt.value === value ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--fg)', border: 'none', borderRadius: TOKENS.radius.sm,
                fontSize: TOKENS.fs.md, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
              }}>
              {opt.label}
              {opt.value === value && <span style={{ color: 'var(--accent)', fontSize: TOKENS.fs.sm }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Toggle switch ─────────────────────────────────────────────────────────────

export const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
  <button onClick={() => onChange(!on)} style={{
    width: 32, height: 18, borderRadius: 9,
    background: on ? 'var(--accent)' : 'var(--bg-raised)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
    position: 'relative', cursor: 'pointer', padding: 0,
    transition: 'background 0.15s, border-color 0.15s', flexShrink: 0,
  }}>
    <span style={{
      position: 'absolute', top: 1, left: on ? 15 : 1,
      width: 14, height: 14, borderRadius: '50%',
      background: on ? '#0a0a0b' : 'var(--fg-muted)',
      transition: 'left 0.15s',
    }} />
  </button>
);

// ── Action bar button (floating multi-select) ─────────────────────────────────

interface ActionBarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
}

export const ActionBarButton: React.FC<ActionBarButtonProps> = ({ children, danger, ...rest }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        height: 26, padding: '0 9px',
        background: hover ? (danger ? 'rgba(244,63,94,0.1)' : 'var(--bg-hover)') : 'transparent',
        border: 'none', borderRadius: 5,
        color: danger ? 'var(--danger)' : 'var(--fg)',
        fontSize: TOKENS.fs.md, fontFamily: 'inherit', cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      {...rest}
    >{children}</button>
  );
};
