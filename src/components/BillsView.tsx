import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, Trash2, X } from 'lucide-react';
import type {
  Account,
  BillFrequency,
  Category,
  RecurringBill,
  UpsertRecurringBillInput,
} from '../types';
import { api } from '../lib/api';
import {
  centsToInputString,
  formatCents,
  formatDueStatus,
  formatShortDate,
  frequencyLabel,
  getTodayIso,
  parseDollarsToCents,
} from '../lib/format';

interface BillsViewProps {
  accounts: Account[];
  categories: Category[];
  onDataChanged: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function BillsView({ accounts, categories, onDataChanged, onNotify }: BillsViewProps) {
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<RecurringBill | null>(null);

  const [name, setName] = useState('');
  const [payee, setPayee] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [frequency, setFrequency] = useState<BillFrequency>('monthly');
  const [nextDueDate, setNextDueDate] = useState(getTodayIso());
  const [autoPay, setAutoPay] = useState(false);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const today = getTodayIso();

  async function loadBills() {
    const list = await api.listRecurringBills(today);
    setBills(list);
  }

  useEffect(() => {
    void loadBills();
  }, []);

  function openNewBill() {
    setEditing(null);
    setName('');
    setPayee('');
    setAmountStr('');
    setCategoryId('cat-utilities');
    setAccountId(accounts[0]?.id ?? '');
    setFrequency('monthly');
    setNextDueDate(today);
    setAutoPay(false);
    setNotes('');
    setFormError(null);
    setShowModal(true);
  }

  function openEditBill(b: RecurringBill) {
    setEditing(b);
    setName(b.name);
    setPayee(b.payee);
    setAmountStr(centsToInputString(b.amountCents));
    setCategoryId(b.categoryId ?? '');
    setAccountId(b.accountId ?? '');
    setFrequency(b.frequency);
    setNextDueDate(b.nextDueDate);
    setAutoPay(b.autoPay);
    setNotes(b.notes);
    setFormError(null);
    setShowModal(true);
  }

  async function handleSaveBill(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const cents = parseDollarsToCents(amountStr);
    if (cents === null || cents <= 0) {
      setFormError('Enter an expected bill amount greater than $0.00.');
      return;
    }
    const payload: UpsertRecurringBillInput = {
      id: editing?.id,
      name,
      payee: payee || name,
      amountCents: cents,
      categoryId: categoryId || null,
      accountId: accountId || null,
      frequency,
      nextDueDate,
      autoPay,
      notes,
      active: true,
    };

    try {
      await api.upsertRecurringBill(payload, today);
      setShowModal(false);
      await loadBills();
      await onDataChanged();
      onNotify(editing ? 'Recurring bill updated.' : 'Recurring bill added.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRecordPayment(bill: RecurringBill) {
    try {
      await api.recordBillPayment(bill.id, today, null);
      await loadBills();
      await onDataChanged();
      onNotify(`Recorded ${formatCents(bill.amountCents)} payment for '${bill.name}' and advanced next due date.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    }
  }

  const monthlyEquivalentCents = bills
    .filter((b) => b.active)
    .reduce((acc, b) => {
      if (b.frequency === 'biweekly') return acc + Math.round((b.amountCents * 26) / 12);
      if (b.frequency === 'quarterly') return acc + Math.round(b.amountCents / 3);
      if (b.frequency === 'yearly') return acc + Math.round(b.amountCents / 12);
      return acc + b.amountCents;
    }, 0);

  return (
    <div className="stack-lg">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Recurring bills &amp; reminders</h2>
            <div className="panel-subtitle tabular">
              {bills.length} scheduled {bills.length === 1 ? 'bill' : 'bills'} · Estimated{' '}
              {formatCents(monthlyEquivalentCents)} per month
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={openNewBill}>
            <Plus size={16} />
            <span>Add recurring bill</span>
          </button>
        </div>

        {bills.length === 0 ? (
          <div className="panel-body" style={{ color: 'var(--ink-muted)' }}>
            No recurring bills added yet. Add monthly obligations like mortgage/rent, electricity,
            internet, or insurance so upcoming due dates appear on your Overview.
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Next due</th>
                  <th>Reminder status</th>
                  <th>Frequency</th>
                  <th>Account &amp; category</th>
                  <th className="num">Amount</th>
                  <th style={{ width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{bill.name}</div>
                      {bill.notes && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                          {bill.notes}
                        </div>
                      )}
                    </td>
                    <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                      {formatShortDate(bill.nextDueDate)}
                    </td>
                    <td>
                      <span
                        className={`chip ${
                          bill.status === 'overdue'
                            ? 'chip-garnet'
                            : bill.status === 'due_soon'
                              ? 'chip-amber'
                              : 'chip-spruce'
                        }`}
                      >
                        {formatDueStatus(bill.daysUntilDue, bill.active)}
                      </span>
                      {bill.autoPay && (
                        <span className="chip" style={{ marginLeft: 6 }}>
                          Autopay
                        </span>
                      )}
                    </td>
                    <td>{frequencyLabel(bill.frequency)}</td>
                    <td style={{ color: 'var(--ink-secondary)', fontSize: '0.84rem' }}>
                      {bill.accountName ?? 'Any account'}
                      {bill.categoryName ? ` · ${bill.categoryName}` : ''}
                    </td>
                    <td className="num" style={{ fontWeight: 650 }}>
                      {formatCents(bill.amountCents)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ marginRight: 6 }}
                        onClick={() => handleRecordPayment(bill)}
                      >
                        <CheckCircle2 size={14} />
                        <span>Record paid</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ marginRight: 4 }}
                        onClick={() => openEditBill(bill)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete bill ${bill.name}`}
                        onClick={async () => {
                          await api.deleteRecurringBill(bill.id);
                          await loadBills();
                          await onDataChanged();
                          onNotify('Recurring bill removed.');
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bill-modal-title"
        >
          <div className="modal-card">
            <div className="modal-header">
              <h2 id="bill-modal-title" style={{ fontSize: '1.06rem' }}>
                {editing ? 'Edit recurring bill' : 'Add recurring bill'}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowModal(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveBill}>
              <div className="modal-body">
                {formError && <div className="error-banner">{formError}</div>}

                <div className="form-row-2">
                  <div>
                    <label className="field-label" htmlFor="bill-name">
                      Bill name
                    </label>
                    <input
                      id="bill-name"
                      className="input"
                      placeholder="e.g., City Electric"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="bill-amt">
                      Expected amount ($)
                    </label>
                    <input
                      id="bill-amt"
                      className="input tabular"
                      placeholder="125.00"
                      value={amountStr}
                      onChange={(e) => setAmountStr(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-row-2">
                  <div>
                    <label className="field-label" htmlFor="bill-due">
                      Next due date
                    </label>
                    <input
                      id="bill-due"
                      type="date"
                      className="input tabular"
                      value={nextDueDate}
                      onChange={(e) => setNextDueDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="bill-freq">
                      Frequency
                    </label>
                    <select
                      id="bill-freq"
                      className="select"
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as BillFrequency)}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="biweekly">Every 2 weeks</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                </div>

                <div className="form-row-2">
                  <div>
                    <label className="field-label" htmlFor="bill-acc">
                      Paid from account
                    </label>
                    <select
                      id="bill-acc"
                      className="select"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      <option value="">Default account</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="bill-cat">
                      Category
                    </label>
                    <select
                      id="bill-cat"
                      className="select"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                    >
                      <option value="">Uncategorized</option>
                      {categories
                        .filter((c) => c.kind === 'expense')
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="bill-notes">
                    Notes
                  </label>
                  <input
                    id="bill-notes"
                    className="input"
                    placeholder="Optional account or reminder note"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoPay}
                    onChange={(e) => setAutoPay(e.target.checked)}
                  />
                  Paid automatically by bank autopay
                </label>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editing ? 'Save changes' : 'Add bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
