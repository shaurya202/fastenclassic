import { useEffect, useState } from 'react';
import { Plus, Search, Sparkles, Trash2, X, Split } from 'lucide-react';
import type {
  Account,
  Category,
  Transaction,
  TransactionFilter,
  TransactionSplitInput,
  UpsertTransactionInput,
} from '../types';
import { api } from '../lib/api';
import { SplitTransactionModal } from './SplitTransactionModal';
import {
  centsToInputString,
  formatCents,
  formatShortDate,
  getTodayIso,
  parseDollarsToCents,
} from '../lib/format';

interface TransactionsViewProps {
  accounts: Account[];
  categories: Category[];
  selectedMonth: string;
  initialAccountFilter: string;
  initialUncategorizedOnly: boolean;
  onDataChanged: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function TransactionsView({
  accounts,
  categories,
  selectedMonth,
  initialAccountFilter,
  initialUncategorizedOnly,
  onDataChanged,
  onNotify,
}: TransactionsViewProps) {
  const [accountId, setAccountId] = useState(initialAccountFilter);
  const [categoryId, setCategoryId] = useState('');
  const [monthScope, setMonthScope] = useState<'all' | 'selected'>('all');
  const [uncategorizedOnly, setUncategorizedOnly] = useState(initialUncategorizedOnly);
  const [search, setSearch] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state for adding or editing a transaction
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formAccountId, setFormAccountId] = useState('');
  const [formDate, setFormDate] = useState(getTodayIso());
  const [formPayee, setFormPayee] = useState('');
  const [formMemo, setFormMemo] = useState('');
  const [formFlow, setFormFlow] = useState<'outflow' | 'inflow'>('outflow');
  const [formAmount, setFormAmount] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formCheckNumber, setFormCheckNumber] = useState('');
  const [formSplits, setFormSplits] = useState<TransactionSplitInput[] | null>(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Prompt to save a categorization rule when user categorizes a transaction inline
  const [rulePrompt, setRulePrompt] = useState<{
    payee: string;
    categoryId: string;
    categoryName: string;
  } | null>(null);

  useEffect(() => {
    setAccountId(initialAccountFilter);
  }, [initialAccountFilter]);

  useEffect(() => {
    setUncategorizedOnly(initialUncategorizedOnly);
  }, [initialUncategorizedOnly]);

  async function loadRegister() {
    setLoading(true);
    try {
      const filter: TransactionFilter = {
        accountId: accountId || undefined,
        categoryId: categoryId || undefined,
        month: monthScope === 'selected' ? selectedMonth : undefined,
        search: search || undefined,
        uncategorizedOnly: uncategorizedOnly || undefined,
      };
      const rows = await api.listTransactions(filter);
      setTransactions(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRegister();
  }, [accountId, categoryId, monthScope, selectedMonth, uncategorizedOnly, search, accounts]);

  function openNewTransaction() {
    setEditingTx(null);
    setFormAccountId(accountId || accounts[0]?.id || '');
    setFormDate(getTodayIso());
    setFormPayee('');
    setFormMemo('');
    setFormFlow('outflow');
    setFormAmount('');
    setFormCategoryId('');
    setFormCheckNumber('');
    setFormSplits(null);
    setFormError(null);
    setShowForm(true);
  }

  function openEditTransaction(tx: Transaction) {
    setEditingTx(tx);
    setFormAccountId(tx.accountId);
    setFormDate(tx.postedDate);
    setFormPayee(tx.payee);
    setFormMemo(tx.memo);
    setFormFlow(tx.amountCents >= 0 ? 'inflow' : 'outflow');
    setFormAmount(centsToInputString(tx.amountCents));
    setFormCategoryId(tx.categoryId ?? '');
    setFormCheckNumber(tx.checkNumber ?? '');
    setFormSplits(
      tx.splits
        ? tx.splits.map((s) => ({
            categoryId: s.categoryId,
            amountCents: s.amountCents,
            memo: s.memo,
          }))
        : null
    );
    setFormError(null);
    setShowForm(true);
  }

  async function handleSaveTransaction(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!formAccountId) {
      setFormError('Choose an account for this transaction.');
      return;
    }
    const cents = parseDollarsToCents(formAmount);
    if (cents === null || cents <= 0) {
      setFormError('Enter a positive dollar amount (for example, 42.50).');
      return;
    }
    const signedCents = formFlow === 'outflow' ? -Math.abs(cents) : Math.abs(cents);
    const payload: UpsertTransactionInput = {
      id: editingTx?.id,
      accountId: formAccountId,
      postedDate: formDate,
      payee: formPayee,
      memo: formMemo,
      amountCents: signedCents,
      categoryId: formSplits && formSplits.length > 0 ? null : (formCategoryId || null),
      cleared: true,
      checkNumber: formCheckNumber.trim() || null,
      splits: formSplits && formSplits.length > 0 ? formSplits : null,
    };

    try {
      await api.upsertTransaction(payload);
      setShowForm(false);
      await loadRegister();
      await onDataChanged();
      onNotify(editingTx ? 'Transaction updated.' : 'Transaction added to register.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleInlineCategoryChange(tx: Transaction, nextCategoryId: string) {
    await api.assignTransactionCategory(tx.id, nextCategoryId || null, null);
    await loadRegister();
    await onDataChanged();

    if (nextCategoryId) {
      const cat = categories.find((c) => c.id === nextCategoryId);
      if (cat && tx.payee.trim().length >= 3) {
        setRulePrompt({
          payee: tx.originalPayee || tx.payee,
          categoryId: cat.id,
          categoryName: cat.name,
        });
      }
    }
  }

  async function handleCreateRuleFromPrompt() {
    if (!rulePrompt) return;
    await api.upsertCategoryRule({
      pattern: rulePrompt.payee,
      matchType: 'contains',
      categoryId: rulePrompt.categoryId,
      priority: 170,
    });
    const updated = await api.applyCategoryRules(true);
    setRulePrompt(null);
    await loadRegister();
    await onDataChanged();
    onNotify(
      updated > 0
        ? `Saved rule for '${rulePrompt.payee}' and categorized ${updated} matching transactions.`
        : `Saved categorization rule for '${rulePrompt.payee}'.`
    );
  }

  const filteredNet = transactions.reduce((sum, t) => sum + t.amountCents, 0);

  return (
    <div className="stack-lg">
      {rulePrompt && (
        <div className="notice-banner" role="status">
          <span>
            Always categorize transactions matching <strong>{rulePrompt.payee}</strong> as{' '}
            <strong>{rulePrompt.categoryName}</strong>?
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={handleCreateRuleFromPrompt}>
              <Sparkles size={14} />
              <span>Save rule</span>
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setRulePrompt(null)}>
              Not now
            </button>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Account register</h2>
            <div className="panel-subtitle tabular">
              {transactions.length} {transactions.length === 1 ? 'transaction' : 'transactions'} shown
              {' · '}Net total {formatCents(filteredNet, { showPlus: true })}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openNewTransaction}
            disabled={accounts.length === 0}
          >
            <Plus size={16} />
            <span>Add transaction</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="filter-bar">
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-muted)',
              }}
            />
            <input
              className="input input-sm"
              style={{ paddingLeft: 32 }}
              placeholder="Search payee, memo, or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search transactions"
            />
          </div>

          <select
            className="select select-sm"
            style={{ width: 'auto', minWidth: 165 }}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            className="select select-sm"
            style={{ width: 'auto', minWidth: 165 }}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            className="select select-sm"
            style={{ width: 'auto', minWidth: 150 }}
            value={monthScope}
            onChange={(e) => setMonthScope(e.target.value as 'all' | 'selected')}
            aria-label="Date range"
          >
            <option value="all">All dates</option>
            <option value="selected">Selected month ({selectedMonth})</option>
          </select>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.83rem',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={uncategorizedOnly}
              onChange={(e) => setUncategorizedOnly(e.target.checked)}
            />
            Uncategorized only
          </label>
        </div>

        {accounts.length === 0 ? (
          <div className="panel-body" style={{ color: 'var(--ink-muted)' }}>
            Create an account first so you can record or import transactions.
          </div>
        ) : loading ? (
          <div className="panel-body" style={{ color: 'var(--ink-muted)' }}>
            Loading register...
          </div>
        ) : transactions.length === 0 ? (
          <div className="panel-body" style={{ color: 'var(--ink-muted)' }}>
            No transactions match the current filter. Clear a filter above, add a manual entry, or
            import a statement.
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee &amp; memo</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="num">Amount</th>
                  <th style={{ width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="tabular" style={{ whiteSpace: 'nowrap', color: 'var(--ink-secondary)' }}>
                      {formatShortDate(tx.postedDate)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {tx.checkNumber && (
                          <span className="badge badge-subtle" style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                            #{tx.checkNumber}
                          </span>
                        )}
                        <span style={{ fontWeight: 600 }}>{tx.payee}</span>
                      </div>
                      {tx.memo && (
                        <div style={{ fontSize: '0.79rem', color: 'var(--ink-muted)' }}>
                          {tx.memo}
                        </div>
                      )}
                    </td>
                    <td style={{ minWidth: 195 }}>
                      {tx.isSplit ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="badge badge-subtle" style={{ fontWeight: 600 }}>
                            Split ({tx.splits?.length || 2} categories)
                          </span>
                        </div>
                      ) : (
                        <select
                          className="select select-sm"
                          value={tx.categoryId ?? ''}
                          onChange={(e) => handleInlineCategoryChange(tx, e.target.value)}
                          aria-label={`Category for ${tx.payee}`}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={{ color: 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
                      {tx.accountName}
                    </td>
                    <td
                      className={`num ${tx.amountCents > 0 ? 'amt-positive' : ''}`}
                      style={{ fontWeight: 650, whiteSpace: 'nowrap' }}
                    >
                      {formatCents(tx.amountCents, { showPlus: true })}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openEditTransaction(tx)}
                        style={{ marginRight: 4 }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete transaction ${tx.payee}`}
                        title="Delete transaction"
                        onClick={async () => {
                          await api.deleteTransaction(tx.id);
                          await loadRegister();
                          await onDataChanged();
                          onNotify('Transaction deleted.');
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

      {showForm && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tx-modal-title"
        >
          <div className="modal-card">
            <div className="modal-header">
              <h2 id="tx-modal-title" style={{ fontSize: '1.06rem' }}>
                {editingTx ? 'Edit transaction' : 'Add transaction'}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveTransaction}>
              <div className="modal-body">
                {formError && <div className="error-banner">{formError}</div>}

                <div className="form-row-2">
                  <div>
                    <label className="field-label" htmlFor="tx-acc">
                      Account
                    </label>
                    <select
                      id="tx-acc"
                      className="select"
                      value={formAccountId}
                      onChange={(e) => setFormAccountId(e.target.value)}
                      required
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="tx-date">
                      Date
                    </label>
                    <input
                      id="tx-date"
                      type="date"
                      className="input tabular"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="tx-payee">
                    Payee or description
                  </label>
                  <input
                    id="tx-payee"
                    className="input"
                    placeholder="e.g., Trader Joe's or City Water"
                    value={formPayee}
                    onChange={(e) => setFormPayee(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="form-row-2">
                  <div>
                    <label className="field-label" htmlFor="tx-flow">
                      Type
                    </label>
                    <select
                      id="tx-flow"
                      className="select"
                      value={formFlow}
                      onChange={(e) => setFormFlow(e.target.value as 'outflow' | 'inflow')}
                    >
                      <option value="outflow">Spending / outflow (-)</option>
                      <option value="inflow">Deposit / inflow (+)</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="tx-amt">
                      Amount ($)
                    </label>
                    <input
                      id="tx-amt"
                      className="input tabular"
                      placeholder="0.00"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-row-2">
                  <div>
                    <label className="field-label" htmlFor="tx-cat">
                      Category
                    </label>
                    {formSplits && formSplits.length > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px' }}>
                        <span className="badge badge-subtle" style={{ fontWeight: 600 }}>
                          Split ({formSplits.length} line items)
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setShowSplitModal(true)}
                        >
                          Edit Splits
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Remove splits"
                          onClick={() => setFormSplits(null)}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <select
                          id="tx-cat"
                          className="select"
                          value={formCategoryId}
                          onChange={(e) => setFormCategoryId(e.target.value)}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title="Split transaction into multiple categories"
                          onClick={() => {
                            const cents = parseDollarsToCents(formAmount);
                            if (!cents || cents <= 0) {
                              setFormError('Please enter an amount before splitting.');
                              return;
                            }
                            setFormError(null);
                            setShowSplitModal(true);
                          }}
                        >
                          <Split size={14} />
                          <span>Split</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="tx-check">
                      Check # (Optional)
                    </label>
                    <input
                      id="tx-check"
                      className="input tabular"
                      placeholder="e.g., 1042"
                      value={formCheckNumber}
                      onChange={(e) => setFormCheckNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="tx-memo">
                    Memo
                  </label>
                  <input
                    id="tx-memo"
                    className="input"
                    placeholder="Optional note"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingTx ? 'Save changes' : 'Save transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showSplitModal && (
        <SplitTransactionModal
          totalAmountCents={
            formFlow === 'outflow'
              ? -(parseDollarsToCents(formAmount) || 0)
              : (parseDollarsToCents(formAmount) || 0)
          }
          categories={categories}
          initialSplits={formSplits ?? undefined}
          onSave={(splits) => {
            setFormSplits(splits);
            setShowSplitModal(false);
          }}
          onClose={() => setShowSplitModal(false)}
        />
      )}
    </div>
  );
}
