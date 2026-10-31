import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { MonthBudgetSummary } from '../types';
import { api } from '../lib/api';
import {
  centsToInputString,
  formatCents,
  formatMonthHeading,
  parseDollarsToCents,
} from '../lib/format';

interface BudgetsViewProps {
  selectedMonth: string;
  onDataChanged: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function BudgetsView({ selectedMonth, onDataChanged, onNotify }: BudgetsViewProps) {
  const [summary, setSummary] = useState<MonthBudgetSummary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function loadBudget() {
    const res = await api.getMonthBudget(selectedMonth);
    setSummary(res);
    const map: Record<string, string> = {};
    for (const r of res.rows) {
      map[r.categoryId] = r.budgetedCents > 0 ? centsToInputString(r.budgetedCents) : '';
    }
    setDrafts(map);
  }

  useEffect(() => {
    void loadBudget();
  }, [selectedMonth]);

  async function saveCategoryLimit(categoryId: string, rawVal: string) {
    const cents = parseDollarsToCents(rawVal);
    if (cents === null || cents < 0) return;
    await api.setCategoryBudget(selectedMonth, categoryId, cents);
    await loadBudget();
    await onDataChanged();
  }

  async function handleCopyLastMonth() {
    const copied = await api.copyPreviousMonthBudget(selectedMonth);
    await loadBudget();
    await onDataChanged();
    onNotify(
      copied > 0
        ? `Copied ${copied} category targets from previous month.`
        : 'No budget targets were set in the previous month.'
    );
  }

  if (!summary) {
    return (
      <div className="panel">
        <div className="panel-body">Loading budget...</div>
      </div>
    );
  }

  const groups = Array.from(new Set(summary.rows.map((r) => r.groupName)));

  return (
    <div className="stack-lg">
      <section className="balance-sheet-strip" aria-label="Monthly budget summary">
        <div className="net-worth-primary">
          <div className="metric-caption">{formatMonthHeading(summary.month)} planned</div>
          <div className="net-worth-figure">{formatCents(summary.totalBudgetedCents)}</div>
          <div className="metric-note">Monthly spending target across categories</div>
        </div>
        <div>
          <div className="metric-caption">Actual spent</div>
          <div className="metric-figure tabular">{formatCents(summary.totalSpentCents)}</div>
          <div className="metric-note">Non-transfer expenses this month</div>
        </div>
        <div>
          <div className="metric-caption">Remaining in budget</div>
          <div
            className={`metric-figure tabular ${
              summary.totalRemainingCents >= 0 ? 'amt-positive' : 'amt-negative'
            }`}
          >
            {formatCents(summary.totalRemainingCents)}
          </div>
          <div className="metric-note">Planned minus actual spending</div>
        </div>
        <div>
          <div className="metric-caption">Month income</div>
          <div className="metric-figure tabular amt-positive">
            {formatCents(summary.incomeCents)}
          </div>
          <div className="metric-note">Recorded deposits &amp; paychecks</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Category budgets for {formatMonthHeading(summary.month)}</h2>
            <div className="panel-subtitle">
              Type a monthly target in any category; actual spending updates automatically from your
              register.
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={handleCopyLastMonth}>
            <Copy size={14} />
            <span>Copy previous month</span>
          </button>
        </div>

        <div className="ledger-table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ width: 170 }}>Monthly budget ($)</th>
                <th className="num">Spent</th>
                <th style={{ width: '28%' }}>Progress</th>
                <th className="num">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((grp) => (
                <FragmentGroup
                  key={grp}
                  groupName={grp}
                  rows={summary.rows.filter((r) => r.groupName === grp)}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  onCommit={saveCategoryLimit}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface FragmentGroupProps {
  groupName: string;
  rows: MonthBudgetSummary['rows'];
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCommit: (categoryId: string, rawVal: string) => Promise<void>;
}

function FragmentGroup({ groupName, rows, drafts, setDrafts, onCommit }: FragmentGroupProps) {
  return (
    <>
      <tr>
        <td
          colSpan={5}
          style={{
            backgroundColor: '#f5f7fa',
            fontWeight: 650,
            fontSize: '0.8rem',
            color: 'var(--ink-secondary)',
            padding: '7px 14px',
          }}
        >
          {groupName}
        </td>
      </tr>
      {rows.map((row) => {
        const pct =
          row.budgetedCents > 0
            ? Math.min(100, Math.round((row.spentCents / row.budgetedCents) * 100))
            : row.spentCents > 0
              ? 100
              : 0;
        const over = row.budgetedCents > 0 && row.spentCents > row.budgetedCents;
        const warn =
          !over && pct >= 85 && row.budgetedCents > 0 && row.spentCents < row.budgetedCents;

        return (
          <tr key={row.categoryId}>
            <td>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                <span className="chip-dot" style={{ backgroundColor: row.color }} />
                {row.categoryName}
              </span>
            </td>
            <td>
              <input
                className="input input-sm tabular"
                placeholder="0.00"
                aria-label={`Monthly budget for ${row.categoryName}`}
                value={drafts[row.categoryId] ?? ''}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [row.categoryId]: e.target.value }))
                }
                onBlur={(e) => void onCommit(row.categoryId, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />
            </td>
            <td className="num" style={{ fontWeight: 600 }}>
              {formatCents(row.spentCents)}
            </td>
            <td>
              <div className="meter-track">
                <div
                  className="meter-fill"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: over
                      ? 'var(--overdraft-garnet)'
                      : warn
                        ? 'var(--due-amber)'
                        : 'var(--oxford-spruce)',
                  }}
                />
              </div>
            </td>
            <td
              className={`num ${
                row.budgetedCents === 0
                  ? ''
                  : row.remainingCents < 0
                    ? 'amt-negative'
                    : 'amt-positive'
              }`}
              style={{ fontWeight: 600 }}
            >
              {row.budgetedCents > 0 ? formatCents(row.remainingCents) : '—'}
            </td>
          </tr>
        );
      })}
    </>
  );
}
