import { useState } from 'react';
import { X } from 'lucide-react';
import type { Account, AccountType, UpsertAccountInput } from '../types';
import {
  centsToInputString,
  getTodayIso,
  isLiabilityAccountType,
  parseDollarsToCents,
} from '../lib/format';

interface AccountModalProps {
  initial?: Account | null;
  onClose: () => void;
  onSave: (input: UpsertAccountInput) => Promise<void>;
  onDelete?: (accountId: string) => Promise<void>;
}

export function AccountModal({ initial, onClose, onSave, onDelete }: AccountModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [accountType, setAccountType] = useState<AccountType>(initial?.accountType ?? 'checking');
  const [institution, setInstitution] = useState(initial?.institution ?? '');
  const [balanceInput, setBalanceInput] = useState(
    initial ? centsToInputString(initial.openingBalanceCents) : '0.00'
  );
  const [openingDate, setOpeningDate] = useState(
    initial?.openingDate ?? `${getTodayIso().slice(0, 4)}-01-01`
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDebt = isLiabilityAccountType(accountType);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedCents = parseDollarsToCents(balanceInput);
    if (parsedCents === null) {
      setError('Enter a valid dollar amount for the starting balance.');
      return;
    }
    const signedOpening = isDebt ? -Math.abs(parsedCents) : parsedCents;
    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        name,
        accountType,
        institution,
        openingBalanceCents: signedOpening,
        openingDate,
        notes,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="account-modal-title" style={{ fontSize: '1.08rem' }}>
            {initial ? 'Edit account' : 'Add household account'}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-banner">{error}</div>}

            <div>
              <label className="field-label" htmlFor="acc-name">
                Account name
              </label>
              <input
                id="acc-name"
                className="input"
                placeholder="e.g., Household Checking or Family Visa"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-row-2">
              <div>
                <label className="field-label" htmlFor="acc-type">
                  Account type
                </label>
                <select
                  id="acc-type"
                  className="select"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                >
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                  <option value="credit_card">Credit card</option>
                  <option value="investment">Investment / retirement</option>
                  <option value="loan">Loan / mortgage</option>
                  <option value="cash">Cash</option>
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="acc-inst">
                  Bank or institution
                </label>
                <input
                  id="acc-inst"
                  className="input"
                  placeholder="Optional"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row-2">
              <div>
                <label className="field-label" htmlFor="acc-bal">
                  {isDebt ? 'Starting balance owed ($)' : 'Starting balance ($)'}
                </label>
                <input
                  id="acc-bal"
                  className="input tabular"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                />
                <div className="field-hint">
                  {isDebt
                    ? 'Balance before your imported transactions (stored as a liability).'
                    : 'Balance before your imported transactions.'}
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="acc-date">
                  Starting date
                </label>
                <input
                  id="acc-date"
                  type="date"
                  className="input tabular"
                  value={openingDate}
                  onChange={(e) => setOpeningDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="acc-notes">
                Notes
              </label>
              <input
                id="acc-notes"
                className="input"
                placeholder="Optional household note"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            {initial && onDelete && (
              <button
                type="button"
                className="btn btn-danger"
                style={{ marginRight: 'auto' }}
                onClick={async () => {
                  if (window.confirm(`Delete '${initial.name}' and all its transactions?`)) {
                    await onDelete(initial.id);
                    onClose();
                  }
                }}
              >
                Delete account
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : initial ? 'Save changes' : 'Add account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
