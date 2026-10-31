import { useRef, useState } from 'react';
import { Check, FileSpreadsheet, FileUp, Plus, SlidersHorizontal } from 'lucide-react';
import type {
  Account,
  Category,
  CsvColumnMapping,
  ImportPreviewResponse,
  ImportPreviewRow,
  NavSection,
} from '../types';
import { api } from '../lib/api';
import { formatCents, formatShortDate } from '../lib/format';
import {
  SAMPLE_CSV_STATEMENT,
  SAMPLE_OFX_STATEMENT,
  SAMPLE_QIF_STATEMENT,
} from '../lib/sampleStatements';

interface ImportViewProps {
  accounts: Account[];
  categories: Category[];
  onOpenAddAccount: () => void;
  onDataChanged: () => Promise<void>;
  onNavigate: (nav: NavSection) => void;
  onNotify: (msg: string) => void;
}

export function ImportView({
  accounts,
  categories,
  onOpenAddAccount,
  onDataChanged,
  onNavigate,
  onNotify,
}: ImportViewProps) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [fileName, setFileName] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping | null>(null);
  const [showColumnMapper, setShowColumnMapper] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [committing, setCommitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveAccountId = accountId || accounts[0]?.id || '';

  async function runPreview(
    targetAccount: string,
    name: string,
    content: string,
    mappingOverride: CsvColumnMapping | null
  ) {
    setError(null);
    if (!targetAccount) {
      setError('Create or select an account first so Fasten Classic knows where to place the transactions.');
      return;
    }
    try {
      const res = await api.previewStatementImport({
        accountId: targetAccount,
        fileName: name,
        content,
        csvMapping: mappingOverride,
      });
      setPreview(res);
      setRows(res.rows);
      if (res.inferredCsvMapping) {
        setCsvMapping(res.inferredCsvMapping);
      }
    } catch (err) {
      setPreview(null);
      setRows([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFileSelected(file: File) {
    const text = await file.text();
    setFileName(file.name);
    setRawContent(text);
    setCsvMapping(null);
    await runPreview(effectiveAccountId, file.name, text, null);
  }

  async function loadSampleStatement(kind: 'csv' | 'ofx' | 'qif') {
    const sampleMap = {
      csv: { name: 'household-checking.csv', content: SAMPLE_CSV_STATEMENT },
      ofx: { name: 'harbor-visa.ofx', content: SAMPLE_OFX_STATEMENT },
      qif: { name: 'quicken-export.qif', content: SAMPLE_QIF_STATEMENT },
    };
    const chosen = sampleMap[kind];
    setFileName(chosen.name);
    setRawContent(chosen.content);
    setCsvMapping(null);
    await runPreview(effectiveAccountId, chosen.name, chosen.content, null);
  }

  async function handleMappingUpdate(next: CsvColumnMapping) {
    setCsvMapping(next);
    if (rawContent) {
      await runPreview(effectiveAccountId, fileName, rawContent, next);
    }
  }

  async function handleCommitImport() {
    if (!preview || !effectiveAccountId) return;
    const selectedRows = rows.filter((r) => r.selected);
    if (selectedRows.length === 0) {
      setError('Select at least one transaction row to import.');
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      const result = await api.commitStatementImport({
        accountId: effectiveAccountId,
        sourceName: fileName || `${preview.detectedFormat.toUpperCase()} import`,
        rows: selectedRows.map((r) => ({
          postedDate: r.postedDate,
          payee: r.payee,
          originalPayee: r.originalPayee,
          memo: r.memo,
          amountCents: r.amountCents,
          categoryId: r.categoryId ?? null,
          externalId: r.externalId ?? null,
          fingerprint: r.fingerprint,
        })),
      });
      await onDataChanged();
      onNotify(
        result.skippedCount > 0
          ? `Imported ${result.importedCount} transactions (${result.skippedCount} duplicates skipped).`
          : `Imported ${result.importedCount} transactions into your register.`
      );
      setPreview(null);
      setRows([]);
      setFileName('');
      setRawContent('');
      onNavigate('transactions');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <section className="panel">
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="panel-title">Add an account before importing a statement</h2>
          <p style={{ color: 'var(--ink-secondary)', maxWidth: '58ch' }}>
            Every bank or credit card statement belongs to an account in your ledger. Create your
            checking, savings, or credit card account first, then import your statement file.
          </p>
          <div>
            <button type="button" className="btn btn-primary" onClick={onOpenAddAccount}>
              <Plus size={16} />
              <span>Add account</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <div className="stack-lg">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Import bank or card statement</h2>
            <div className="panel-subtitle">
              Supports CSV spreadsheets, OFX/QFX bank downloads, and Quicken QIF exports
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label htmlFor="import-account-select" style={{ fontSize: '0.84rem', fontWeight: 600 }}>
              Import into:
            </label>
            <select
              id="import-account-select"
              className="select select-sm"
              style={{ width: 'auto', minWidth: 210 }}
              value={effectiveAccountId}
              onChange={async (e) => {
                const nextAcc = e.target.value;
                setAccountId(nextAcc);
                if (rawContent) {
                  await runPreview(nextAcc, fileName, rawContent, csvMapping);
                }
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div className="error-banner" role="alert">{error}</div>}

          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFileSelected(file);
            }}
          >
            <FileUp size={26} color="var(--oxford-spruce)" />
            <div style={{ fontWeight: 600 }}>
              {fileName
                ? `Loaded ${fileName}`
                : 'Drop a CSV, OFX, QFX, or QIF statement here'}
            </div>
            <p style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', maxWidth: '52ch' }}>
              You will review every transaction, check automatic categories, and see any duplicate
              entries before anything is saved to your register.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.ofx,.qfx,.qif,.txt"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelected(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose statement file
              </button>
              <button type="button" className="btn btn-sm" onClick={() => loadSampleStatement('csv')}>
                <FileSpreadsheet size={14} />
                <span>Try sample CSV</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => loadSampleStatement('ofx')}>
                Try sample OFX
              </button>
              <button type="button" className="btn btn-sm" onClick={() => loadSampleStatement('qif')}>
                Try sample QIF
              </button>
            </div>
          </div>
        </div>
      </section>

      {preview && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">
                Review {preview.detectedFormat.toUpperCase()} statement preview
              </h2>
              <div className="panel-subtitle tabular">
                {preview.totalRows} rows parsed · {preview.newRows} new ·{' '}
                {preview.duplicateRows} duplicates automatically unchecked
                {preview.statementBalanceCents != null
                  ? ` · Statement ending balance ${formatCents(preview.statementBalanceCents)}`
                  : ''}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {preview.csvHeaders && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowColumnMapper((v) => !v)}
                >
                  <SlidersHorizontal size={14} />
                  <span>CSV columns</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={committing || selectedCount === 0}
                onClick={handleCommitImport}
              >
                <Check size={16} />
                <span>
                  {committing
                    ? 'Saving...'
                    : `Save ${selectedCount} ${selectedCount === 1 ? 'transaction' : 'transactions'}`}
                </span>
              </button>
            </div>
          </div>

          {showColumnMapper && preview.csvHeaders && csvMapping && (
            <div
              style={{
                padding: '14px 20px',
                backgroundColor: 'var(--checkbook-slate)',
                borderBottom: '1px solid var(--rule-line)',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 12,
                alignItems: 'end',
              }}
            >
              {(
                [
                  ['dateCol', 'Date column'],
                  ['payeeCol', 'Payee / description'],
                  ['memoCol', 'Memo column'],
                  ['amountCol', 'Single amount'],
                  ['debitCol', 'Debit / outflow'],
                  ['creditCol', 'Credit / inflow'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="field-label">{label}</label>
                  <select
                    className="select select-sm"
                    value={csvMapping[key] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      void handleMappingUpdate({ ...csvMapping, [key]: val });
                    }}
                  >
                    <option value="">None</option>
                    {preview.csvHeaders!.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: '0.83rem',
                  minHeight: 32,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(csvMapping.invertAmount)}
                  onChange={(e) =>
                    void handleMappingUpdate({ ...csvMapping, invertAmount: e.target.checked })
                  }
                />
                Flip +/- signs
              </label>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="notice-banner" style={{ margin: '12px 20px 0' }}>
              <span>{preview.warnings.join(' · ')}</span>
            </div>
          )}

          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th style={{ width: 42 }}>
                    <input
                      type="checkbox"
                      aria-label="Toggle all non-duplicate rows"
                      checked={rows.length > 0 && rows.every((r) => r.selected)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRows((prev) => prev.map((r) => ({ ...r, selected: checked })));
                      }}
                    />
                  </th>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowIndex}
                    className={row.isDuplicate ? 'row-duplicate' : ''}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        aria-label={`Select row ${row.rowIndex + 1} (${row.payee})`}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setRows((prev) =>
                            prev.map((item) =>
                              item.rowIndex === row.rowIndex ? { ...item, selected: checked } : item
                            )
                          );
                        }}
                      />
                    </td>
                    <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                      {formatShortDate(row.postedDate)}
                    </td>
                    <td>
                      <input
                        className="input input-sm"
                        value={row.payee}
                        aria-label={`Payee for row ${row.rowIndex + 1}`}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRows((prev) =>
                            prev.map((item) =>
                              item.rowIndex === row.rowIndex ? { ...item, payee: val } : item
                            )
                          );
                        }}
                      />
                      {row.memo && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                          {row.memo}
                        </div>
                      )}
                    </td>
                    <td style={{ minWidth: 190 }}>
                      <select
                        className="select select-sm"
                        value={row.categoryId ?? ''}
                        aria-label={`Category for row ${row.rowIndex + 1}`}
                        onChange={(e) => {
                          const nextCat = e.target.value || null;
                          setRows((prev) =>
                            prev.map((item) =>
                              item.rowIndex === row.rowIndex
                                ? { ...item, categoryId: nextCat }
                                : item
                            )
                          );
                        }}
                      >
                        <option value="">Uncategorized</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {row.isDuplicate ? (
                        <span className="chip chip-amber" title={row.duplicateReason ?? ''}>
                          Duplicate skipped
                        </span>
                      ) : row.matchedRuleId ? (
                        <span className="chip chip-spruce">Auto-categorized</span>
                      ) : (
                        <span className="chip">Ready</span>
                      )}
                    </td>
                    <td
                      className={`num ${row.amountCents > 0 ? 'amt-positive' : ''}`}
                      style={{ fontWeight: 650, whiteSpace: 'nowrap' }}
                    >
                      {formatCents(row.amountCents, { showPlus: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
