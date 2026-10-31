import { CheckCircle2, FileUp, Plus, Sparkles } from 'lucide-react';
import type { DashboardSummary, NavSection } from '../types';
import {
  formatCents,
  formatDueStatus,
  formatMonthHeading,
  formatShortDate,
} from '../lib/format';

interface OverviewViewProps {
  summary: DashboardSummary;
  onNavigate: (nav: NavSection) => void;
  onOpenAddAccount: () => void;
  onLoadSampleData: () => Promise<void>;
  onRecordBillPaid: (billId: string) => Promise<void>;
  onOpenUncategorized: () => void;
}

export function OverviewView({
  summary,
  onNavigate,
  onOpenAddAccount,
  onLoadSampleData,
  onRecordBillPaid,
  onOpenUncategorized,
}: OverviewViewProps) {
  if (summary.accounts.length === 0) {
    return (
      <section className="welcome-panel">
        <h2 className="welcome-headline">
          Household finances, on your computer
        </h2>
        <p style={{ color: 'var(--ink-secondary)', maxWidth: '62ch', marginBottom: 22 }}>
          Fasten Classic keeps your accounts, statement imports, monthly budgets, and bill
          reminders in a single local ledger on this machine—with no subscription and no cloud
          account required.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="button" className="btn btn-primary" onClick={onOpenAddAccount}>
            <Plus size={16} />
            <span>Add your first account</span>
          </button>
          <button type="button" className="btn" onClick={onLoadSampleData}>
            <Sparkles size={16} />
            <span>Explore with sample household data</span>
          </button>
        </div>

        <div
          style={{
            marginTop: 26,
            paddingTop: 20,
            borderTop: '1px solid var(--rule-subtle)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 16,
            fontSize: '0.86rem',
            color: 'var(--ink-secondary)',
          }}
        >
          <div>
            <strong style={{ color: 'var(--bankers-ink)', display: 'block', marginBottom: 3 }}>
              Import bank statements
            </strong>
            Preview CSV, OFX/QFX, and Quicken QIF files with automatic duplicate checks before
            saving.
          </div>
          <div>
            <strong style={{ color: 'var(--bankers-ink)', display: 'block', marginBottom: 3 }}>
              Plan monthly spending
            </strong>
            Set plain-English category budgets and see how your month tracks against real spending.
          </div>
          <div>
            <strong style={{ color: 'var(--bankers-ink)', display: 'block', marginBottom: 3 }}>
              Own your backups
            </strong>
            Export or restore a verified backup file anytime—your financial history stays yours.
          </div>
        </div>
      </section>
    );
  }

  const maxTrendValue = Math.max(
    10_000,
    ...summary.monthlyTrends.flatMap((t) => [t.incomeCents, t.expenseCents])
  );

  const budgetPct =
    summary.totalBudgetedCents > 0
      ? Math.min(100, Math.round((summary.totalBudgetSpentCents / summary.totalBudgetedCents) * 100))
      : 0;

  return (
    <div className="stack-lg">
      {summary.uncategorizedCount > 0 && (
        <div className="notice-banner" role="status">
          <span>
            <strong>{summary.uncategorizedCount}</strong>{' '}
            {summary.uncategorizedCount === 1
              ? 'transaction needs a category'
              : 'transactions need a category'}{' '}
            so your monthly budget and spending reports stay accurate.
          </span>
          <button type="button" className="btn btn-sm" onClick={onOpenUncategorized}>
            Review uncategorized
          </button>
        </div>
      )}

      {/* Memorable Centerpiece: Household Balance Sheet Strip */}
      <section className="balance-sheet-strip" aria-label="Household balance sheet">
        <div className="net-worth-primary">
          <div className="metric-caption">Household net worth</div>
          <div className="net-worth-figure">{formatCents(summary.netWorthCents)}</div>
          <div className="metric-note">
            Across {summary.accounts.length}{' '}
            {summary.accounts.length === 1 ? 'account' : 'accounts'} stored locally
          </div>
        </div>

        <div>
          <div className="metric-caption">Cash &amp; investments</div>
          <div className="metric-figure tabular">{formatCents(summary.assetsCents)}</div>
          <div className="metric-note">Positive account balances</div>
        </div>

        <div>
          <div className="metric-caption">Credit cards &amp; loans</div>
          <div className="metric-figure tabular">
            {summary.liabilitiesCents > 0 ? formatCents(-summary.liabilitiesCents) : '$0.00'}
          </div>
          <div className="metric-note">Current debt balances</div>
        </div>

        <div>
          <div className="metric-caption">{formatMonthHeading(summary.month)} net flow</div>
          <div
            className={`metric-figure tabular ${
              summary.monthNetCents >= 0 ? 'amt-positive' : 'amt-negative'
            }`}
          >
            {formatCents(summary.monthNetCents, { showPlus: true })}
          </div>
          <div className="metric-note tabular">
            In {formatCents(summary.monthIncomeCents)} / Out {formatCents(summary.monthExpenseCents)}
          </div>
        </div>
      </section>

      <div className="overview-grid">
        <div className="stack-lg">
          {/* 6-Month Cash Flow */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Six-month cash flow</h2>
                <div className="panel-subtitle">
                  Monthly income compared with non-transfer household spending
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: '0.8rem', color: 'var(--ink-secondary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: 'var(--oxford-spruce)',
                    }}
                  />
                  Income
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#93a8bc' }} />
                  Spending
                </span>
              </div>
            </div>
            <div className="panel-body">
              <div className="trend-chart">
                {summary.monthlyTrends.map((pt) => {
                  const incH = Math.max(3, Math.round((pt.incomeCents / maxTrendValue) * 124));
                  const expH = Math.max(3, Math.round((pt.expenseCents / maxTrendValue) * 124));
                  return (
                    <div key={pt.month} className="trend-col">
                      <div
                        className="trend-bars"
                        title={`${pt.label}: Income ${formatCents(pt.incomeCents)}, Spending ${formatCents(pt.expenseCents)}`}
                      >
                        <div className="trend-bar income" style={{ height: `${incH}px` }} />
                        <div className="trend-bar expense" style={{ height: `${expH}px` }} />
                      </div>
                      <span className="trend-label">{pt.label.split(' ')[0]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Recent Transactions */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Recent register activity</h2>
                <div className="panel-subtitle">Latest posted entries across your accounts</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => onNavigate('import')}>
                  <FileUp size={14} />
                  <span>Import statement</span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onNavigate('transactions')}
                >
                  Open full register
                </button>
              </div>
            </div>

            {summary.recentTransactions.length === 0 ? (
              <div className="panel-body" style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                No transactions recorded yet. Import a CSV, OFX, or QIF statement or add a manual
                transaction.
              </div>
            ) : (
              <div className="ledger-table-wrap">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Payee &amp; account</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recentTransactions.slice(0, 8).map((tx) => (
                      <tr key={tx.id}>
                        <td className="tabular" style={{ whiteSpace: 'nowrap', color: 'var(--ink-secondary)' }}>
                          {formatShortDate(tx.postedDate)}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{tx.payee}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                            {tx.accountName}
                          </div>
                        </td>
                        <td>
                          {tx.categoryName ? (
                            <span className="chip">
                              <span
                                className="chip-dot"
                                style={{ backgroundColor: tx.categoryColor ?? '#64748B' }}
                              />
                              {tx.categoryName}
                            </span>
                          ) : (
                            <span className="chip chip-amber">Needs category</span>
                          )}
                        </td>
                        <td
                          className={`num ${
                            tx.amountCents > 0 ? 'amt-positive' : ''
                          }`}
                          style={{ fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          {formatCents(tx.amountCents, { showPlus: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right Operational Column */}
        <div className="stack-lg">
          {/* Monthly Budget Snapshot */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">{formatMonthHeading(summary.month)} budget</h2>
                <div className="panel-subtitle">
                  {summary.totalBudgetedCents > 0
                    ? `${formatCents(summary.totalBudgetSpentCents)} spent of ${formatCents(summary.totalBudgetedCents)}`
                    : 'Set monthly category targets'}
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => onNavigate('budgets')}>
                Adjust budget
              </button>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {summary.totalBudgetedCents > 0 && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.84rem',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>Overall budget used</span>
                    <span className="tabular" style={{ fontWeight: 600 }}>
                      {budgetPct}%
                    </span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${budgetPct}%`,
                        backgroundColor:
                          summary.totalBudgetSpentCents > summary.totalBudgetedCents
                            ? 'var(--overdraft-garnet)'
                            : budgetPct >= 85
                              ? 'var(--due-amber)'
                              : 'var(--oxford-spruce)',
                      }}
                    />
                  </div>
                </div>
              )}

              {summary.topSpendingCategories.length === 0 ? (
                <p style={{ fontSize: '0.86rem', color: 'var(--ink-muted)' }}>
                  No categorized spending recorded in {formatMonthHeading(summary.month)} yet.
                </p>
              ) : (
                summary.topSpendingCategories.slice(0, 5).map((cat) => (
                  <div key={cat.categoryId}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.85rem',
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span className="chip-dot" style={{ backgroundColor: cat.color }} />
                        <span>{cat.categoryName}</span>
                      </span>
                      <span className="tabular" style={{ fontWeight: 600 }}>
                        {formatCents(cat.amountCents)}
                      </span>
                    </div>
                    <div className="meter-track" style={{ height: 6 }}>
                      <div
                        className="meter-fill"
                        style={{
                          width: `${Math.max(4, cat.percentage)}%`,
                          backgroundColor: cat.color,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Upcoming Bills & Reminders */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Bills &amp; reminders</h2>
                <div className="panel-subtitle">Scheduled household obligations</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => onNavigate('bills')}>
                Manage bills
              </button>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {summary.upcomingBills.length === 0 ? (
                <p style={{ fontSize: '0.86rem', color: 'var(--ink-muted)' }}>
                  Add recurring bills like rent, utilities, or insurance to get due-date reminders.
                </p>
              ) : (
                summary.upcomingBills.slice(0, 5).map((bill) => (
                  <div
                    key={bill.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      paddingBottom: 10,
                      borderBottom: '1px solid var(--rule-subtle)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{bill.name}</div>
                      <div style={{ fontSize: '0.79rem', color: 'var(--ink-muted)' }}>
                        <span
                          className={
                            bill.status === 'overdue'
                              ? 'amt-negative'
                              : bill.status === 'due_soon'
                                ? 'amt-warning'
                                : ''
                          }
                          style={{ fontWeight: 600 }}
                        >
                          {formatDueStatus(bill.daysUntilDue, bill.active)}
                        </span>{' '}
                        ({formatShortDate(bill.nextDueDate)})
                        {bill.autoPay ? ' · Autopay' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tabular" style={{ fontWeight: 650, fontSize: '0.9rem' }}>
                        {formatCents(bill.amountCents)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="Record bill payment in register and advance due date"
                        onClick={() => onRecordBillPaid(bill.id)}
                      >
                        <CheckCircle2 size={14} />
                        <span>Paid</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
