/**
 * NotificationHistoryButton — bell icon in the app header that opens a
 * dropdown listing every toast pushed this session (newest first), including
 * ones the user already dismissed with the toast's own X button.
 *
 * See specs/backlog/cross-repo-import-resolution-gaps.md ("Runde 2") — the
 * user wanted a way to find a dismissed notification again. Session-only
 * (Alt. 1 from that spec): the history resets on reload, same as other
 * canvas/UI-ephemeral state in this app.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useAppStore, type Toast } from '@linkml-editor/core';

const SEVERITY_COLOR: Record<Toast['severity'], string> = {
  info: 'var(--color-fg-secondary)',
  success: 'var(--color-state-success)',
  warning: 'var(--color-state-warning)',
  error: 'var(--color-state-error)',
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

export function NotificationHistoryButton() {
  const toastHistory = useAppStore((s) => s.toastHistory);
  const clearToastHistory = useAppStore((s) => s.clearToastHistory);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside);
      return () => document.removeEventListener('mousedown', handleOutside);
    }
  }, [open]);

  const newestFirst = [...toastHistory].reverse();

  return (
    <div ref={menuRef} style={styles.container}>
      <button
        style={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        title="Notification history"
        aria-label="Notification history"
      >
        <Bell size={15} />
      </button>

      {open && (
        <div style={styles.dropdown}>
          <div style={styles.header}>
            <span style={styles.headerTitle}>Notifications</span>
            {newestFirst.length > 0 && (
              <button style={styles.clearBtn} onClick={clearToastHistory}>
                Clear
              </button>
            )}
          </div>
          <div style={styles.divider} />
          {newestFirst.length === 0 ? (
            <div style={styles.empty}>No notifications yet</div>
          ) : (
            <div style={styles.list}>
              {newestFirst.map((t) => (
                <div key={t.id} style={styles.item}>
                  <span style={{ ...styles.itemDot, background: SEVERITY_COLOR[t.severity] }} />
                  <div style={styles.itemBody}>
                    <div style={styles.itemMessage}>{t.message}</div>
                    <div style={styles.itemTime}>{formatRelativeTime(t.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 5,
    color: 'var(--color-fg-secondary)',
    padding: '4px 6px',
    cursor: 'pointer',
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    background: 'var(--color-bg-canvas)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 6,
    width: 320,
    maxWidth: '90vw',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    zIndex: 4000,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-fg-primary)',
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-fg-secondary)',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 4px',
  },
  divider: {
    height: 1,
    background: 'var(--color-border-subtle)',
    margin: 0,
  },
  empty: {
    padding: '20px 14px',
    textAlign: 'center',
    fontSize: 12,
    color: 'var(--color-fg-secondary)',
  },
  list: {
    maxHeight: 320,
    overflowY: 'auto',
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 12px',
    borderBottom: '1px solid var(--color-border-subtle)',
  },
  itemDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    marginTop: 4,
    flexShrink: 0,
  },
  itemBody: {
    minWidth: 0,
    flex: 1,
  },
  itemMessage: {
    fontSize: 12,
    color: 'var(--color-fg-primary)',
    wordBreak: 'break-word',
  },
  itemTime: {
    fontSize: 10,
    color: 'var(--color-fg-secondary)',
    marginTop: 2,
  },
};
