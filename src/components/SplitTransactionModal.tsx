import { useState, useId } from 'react';
import { Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Category, TransactionSplitInput } from '../types';
import { formatCents, parseCurrencyInput } from '../lib/format';

interface SplitTransactionModalProps {
  totalAmountCents: number;
  categories: Category[];
  initialSplits?: TransactionSplitInput[];
  onSave: (splits: TransactionSplitInput[]) => void;
  onClose: () => void;
}

export function SplitTransactionModal({
  totalAmountCents,
  categories,
  initialSplits,
  onSave,
  onClose,
}: SplitTransactionModalProps) {
  const isExpense = totalAmountCents < 0;
  const absTotalCents = Math.abs(totalAmountCents);

  const [splits, setSplits] = useState<TransactionSplitInput[]>(() => {
    if (initialSplits && initialSplits.length > 0) {
      return initialSplits.map((s) => ({
        ...s,
        amountCents: Math.abs(s.amountCents),
      }));
    }
    // Default to 2 empty split rows
    return [
      { categoryId: null, amountCents: 0, memo: '' },
      { categoryId: null, amountCents: 0, memo: '' },
    ];
  });

  const allocatedCents = splits.reduce((sum, s) => sum + (s.amountCents || 0), 0);
  const remainingCents = absTotalCents - allocatedCents;
  const isBalanced = remainingCents === 0;

  function updateRow(index: number, updates: Partial<TransactionSplitInput>) {
    setSplits((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...updates } : row))
    );
  }

  function addRow() {
    setSplits((prev) => [
      ...prev,
      { categoryId: null, amountCents: Math.max(0, remainingCents), memo: '' },
    ]);
  }

  function removeRow(index: number) {
    if (splits.length <= 1) return;
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    if (!isBalanced) return;
    // Apply positive or negative sign matching the parent transaction
    const finalSplits: TransactionSplitInput[] = splits.map((s) => ({
      categoryId: s.categoryId || null,
      amountCents: isExpense ? -Math.abs(s.amountCents) : Math.abs(s.amountCents),
      memo: s.memo?.trim() || null,
    }));
    onSave(finalSplits);
  }

  const titleId = useId();

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">Split Transaction</h2>
            <p className="modal-subtitle">
              Allocate total of{' '}
              <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatCents(totalAmountCents)}</strong> across multiple categories.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 14px',
              backgroundColor: isBalanced ? 'var(--bg-subtle)' : '#fff8f6',
              border: `1px solid ${isBalanced ? 'var(--border-subtle)' : '#ffd1cb'}`,
              borderRadius: 'var(--radius-sm)',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isBalanced ? (
                <CheckCircle2 size={18} style={{ color: 'var(--ink)' }} />
              ) : (
                <AlertCircle size={18} style={{ color: '#b91c1c' }} />
              )}
              <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>
                {isBalanced ? 'Splits are fully balanced' : 'Splits must sum exactly to total amount'}
              </span>
            </div>
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.88rem' }}>
              <div>Allocated: <strong>{formatCents(isExpense ? -allocatedCents : allocatedCents)}</strong></div>
              <div style={{ color: isBalanced ? 'var(--ink-muted)' : '#b91c1c' }}>
                Remaining: <strong>{formatCents(isExpense ? -remainingCents : remainingCents)}</strong>
              </div>
            </div>
          </div>

          <div className="table-wrapper" style={{ maxHeight: '320px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th style={{ width: '220px' }}>Category</th>
                  <th style={{ width: '150px' }}>Amount ($)</th>
                  <th>Line Memo</th>
                  <th style={{ width: '44px' }}></th>
                </tr>
              </thead>
              <tbody>
                {splits.map((split, idx) => (
                  <tr key={idx}>
                    <td style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}>{idx + 1}</td>
                    <td>
                      <select
                        className="form-input"
                        value={split.categoryId || ''}
                        onChange={(e) => updateRow(idx, { categoryId: e.target.value || null })}
                      >
                        <option value="">(Select category)</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.kind})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="0.00"
                        style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}
                        value={split.amountCents ? (split.amountCents / 100).toFixed(2) : ''}
                        onChange={(e) => {
                          const parsed = parseCurrencyInput(e.target.value);
                          updateRow(idx, { amountCents: Math.abs(parsed || 0) });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Optional line memo"
                        value={split.memo || ''}
                        onChange={(e) => updateRow(idx, { memo: e.target.value })}
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Remove row"
                        disabled={splits.length <= 1}
                        onClick={() => removeRow(idx)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '12px' }}>
            <button type="button" className="btn btn-secondary" onClick={addRow}>
              <Plus size={15} />
              <span>Add Split Line</span>
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isBalanced || allocatedCents === 0}
            onClick={handleSave}
          >
            Apply Splits
          </button>
        </div>
      </div>
    </div>
  );
}
