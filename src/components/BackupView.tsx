import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { save, open } from '@tauri-apps/plugin-dialog';
import type { StorageInfo } from '../types';
import { api, isTauriDesktop } from '../lib/api';
import { formatBytes, getTodayIso } from '../lib/format';

interface BackupViewProps {
  selectedMonth: string;
  onDataChanged: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function BackupView({ selectedMonth, onDataChanged, onNotify }: BackupViewProps) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshInfo() {
    const s = await api.getStorageInfo();
    setInfo(s);
  }

  useEffect(() => {
    void refreshInfo();
  }, []);

  async function handleExportBackup() {
    setError(null);
    setBusy(true);
    try {
      const defaultFile = `fasten-classic-backup-${getTodayIso()}.fastenbackup.json`;
      if (isTauriDesktop()) {
        const chosen = await save({
          title: 'Save Fasten Classic backup',
          defaultPath: defaultFile,
          filters: [{ name: 'Fasten Classic Backup', extensions: ['json'] }],
        });
        if (!chosen) return;
        await api.exportBackupToFile(chosen);
        onNotify(`Saved verified backup to ${chosen}`);
      } else {
        const json = await api.exportBackupJson();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFile;
        a.click();
        URL.revokeObjectURL(url);
        onNotify(`Downloaded ${defaultFile}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleNativeRestoreClick() {
    setError(null);
    if (isTauriDesktop()) {
      const chosen = await open({
        title: 'Restore Fasten Classic backup',
        multiple: false,
        filters: [{ name: 'Fasten Classic Backup', extensions: ['json'] }],
      });
      if (!chosen || typeof chosen !== 'string') return;
      if (
        !window.confirm(
          'Restoring this backup will replace the accounts, transactions, categories, and budgets currently on screen. Continue?'
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        await api.restoreBackupFromFile(chosen);
        await onDataChanged();
        await refreshInfo();
        onNotify('Backup verified and restored.');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } else {
      restoreInputRef.current?.click();
    }
  }

  const MAX_BACKUP_BYTES = 50 * 1024 * 1024; // 50 MB

  async function handleRestoreFileInput(file: File) {
    setError(null);
    if (file.size > MAX_BACKUP_BYTES) {
      setError('Backup file exceeds maximum allowed size (50 MB).');
      return;
    }
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.json') && !lowerName.endsWith('.fastenbackup.json')) {
      setError('Please select a valid Fasten Classic backup file (.json or .fastenbackup.json).');
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      await api.restoreBackupJson(text);
      await onDataChanged();
      await refreshInfo();
      onNotify(`Restored backup from ${file.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Local data &amp; backup</h2>
            <div className="panel-subtitle">
              Your financial data stays on your computer and works offline without an account
            </div>
          </div>
          <span className="chip chip-spruce">
            <ShieldCheck size={14} />
            100% local storage
          </span>
        </div>

        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {info && (
            <div
              style={{
                backgroundColor: 'var(--checkbook-slate)',
                border: '1px solid var(--rule-line)',
                borderRadius: 'var(--radius-inner)',
                padding: '14px 16px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 14,
              }}
            >
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="field-label" style={{ marginBottom: 2 }}>
                  Local ledger location
                </div>
                <code style={{ fontSize: '0.84rem', wordBreak: 'break-all' }}>
                  {info.databasePath}
                </code>
              </div>
              <div>
                <div className="field-label">Database size</div>
                <div className="tabular" style={{ fontWeight: 600 }}>
                  {formatBytes(info.databaseSizeBytes)}
                </div>
              </div>
              <div>
                <div className="field-label">Accounts</div>
                <div className="tabular" style={{ fontWeight: 600 }}>
                  {info.accountCount}
                </div>
              </div>
              <div>
                <div className="field-label">Transactions</div>
                <div className="tabular" style={{ fontWeight: 600 }}>
                  {info.transactionCount}
                </div>
              </div>
              <div>
                <div className="field-label">Categories &amp; rules</div>
                <div className="tabular" style={{ fontWeight: 600 }}>
                  {info.categoryCount} / {info.ruleCount}
                </div>
              </div>
            </div>
          )}

          <div className="overview-grid">
            <div
              style={{
                border: '1px solid var(--rule-line)',
                borderRadius: 'var(--radius-inner)',
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <h3 style={{ fontSize: '0.96rem' }}>Create a backup copy</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-secondary)' }}>
                Saves a single portable <code>.fastenbackup.json</code> file containing all your
                accounts, transactions, categories, rules, monthly budgets, and recurring bills with
                a SHA-256 integrity check.
              </p>
              <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={handleExportBackup}
                >
                  <Download size={16} />
                  <span>Create backup file</span>
                </button>
              </div>
            </div>

            <div
              style={{
                border: '1px solid var(--rule-line)',
                borderRadius: 'var(--radius-inner)',
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <h3 style={{ fontSize: '0.96rem' }}>Restore from backup</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-secondary)' }}>
                Verifies the backup file&apos;s SHA-256 checksum before atomically restoring your
                household ledger. Corrupted or incomplete files are rejected safely without
                modifying your current data.
              </p>
              <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleRestoreFileInput(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={handleNativeRestoreClick}
                >
                  <Upload size={16} />
                  <span>Restore from backup file</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Sample data &amp; reset</h2>
            <div className="panel-subtitle">
              Try Fasten Classic with realistic household accounts or clear everything to start
              fresh
            </div>
          </div>
        </div>
        <div
          className="panel-body"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}
        >
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.loadSampleHouseholdData(selectedMonth);
                await onDataChanged();
                await refreshInfo();
                onNotify('Loaded sample household accounts, transactions, budgets, and bills.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Sparkles size={16} />
            <span>Load sample household data</span>
          </button>

          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              if (
                window.confirm(
                  'Clear all accounts, transactions, budgets, and bills from this computer? Create a backup first if you want to keep your current ledger.'
                )
              ) {
                setBusy(true);
                try {
                  await api.resetAllData();
                  await onDataChanged();
                  await refreshInfo();
                  onNotify('Cleared local ledger and restored default categories.');
                } finally {
                  setBusy(false);
                }
              }
            }}
          >
            <RotateCcw size={15} />
            <Trash2 size={15} style={{ display: 'none' }} />
            <span>Reset ledger to empty</span>
          </button>
        </div>
      </section>
    </div>
  );
}
