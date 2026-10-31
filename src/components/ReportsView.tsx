import { useState, useEffect, useCallback } from 'react';
import { Download, BarChart3, Users, DollarSign } from 'lucide-react';
import type { DashboardSummary, IncomeExpenseReport } from '../types';
import { api } from '../lib/api';
import { accountTypeLabel, formatCents, formatMonthHeading, getTodayIso } from '../lib/format';

interface ReportsViewProps {
  summary: DashboardSummary;
}

export function ReportsView({ summary }: ReportsViewProps) {
  const [reportTab, setReportTab] = useState<'balance' | 'pnl' | 'payees'>('balance');

  // Custom P&L date range
  const curYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState<string>(`${curYear}-01-01`);
  const [endDate, setEndDate] = useState<string>(getTodayIso());
  const [pnlReport, setPnlReport] = useState<IncomeExpenseReport | null>(null);
  const [pnlLoading, setPnlLoading] = useState<boolean>(false);

  const loadPnl = useCallback(async () => {
    if (!startDate || !endDate) return;
    setPnlLoading(true);
    try {
      const data = await api.getIncomeExpenseReport(startDate, endDate);
      setPnlReport(data);
    } catch (err) {
      console.error('Failed to load P&L report:', err);
    } finally {
      setPnlLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (reportTab === 'pnl' || reportTab === 'payees') {
      void loadPnl();
    }
  }, [reportTab, loadPnl]);

  const positiveAccounts = summary.accounts.filter((a) => a.currentBalanceCents >= 0);
  const debtAccounts = summary.accounts.filter((a) => a.currentBalanceCents < 0);

  function exportPnlCsv() {
    if (!pnlReport) return;
    const rows = [
      ['Report', 'Income & Expense Statement (P&L)'],
      ['Period', `${pnlReport.startDate} to ${pnlReport.endDate}`],
      ['Total Income ($)', (pnlReport.totalIncomeCents / 100).toFixed(2)],
      ['Total Expenses ($)', (pnlReport.totalExpenseCents / 100).toFixed(2)],
      ['Net Savings ($)', (pnlReport.netSavingsCents / 100).toFixed(2)],
      ['Savings Rate (%)', `${pnlReport.savingsRatePercent.toFixed(1)}%`],
      [],
      ['Category Breakdown', 'Category Name', 'Amount ($)', 'Percentage (%)'],
      ...pnlReport.categoryBreakdown.map((c) => [
        '',
        `"${c.categoryName}"`,
        (c.amountCents / 100).toFixed(2),
        `${c.percentage.toFixed(1)}%`,
      ]),
      [],
      ['Top Payees', 'Payee Name', 'Transactions', 'Total Spent ($)', 'Avg Spent ($)'],
      ...pnlReport.topPayees.map((p) => [
        '',
        `"${p.payee}"`,
        p.transactionCount.toString(),
        (p.totalSpentCents / 100).toFixed(2),
        (p.averageSpentCents / 100).toFixed(2),
      ]),
    ];

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `FastenClassic_Report_${pnlReport.startDate}_${pnlReport.endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="stack-lg">
      {/* Sub-navigation tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${reportTab === 'balance' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setReportTab('balance')}
          >
            <BarChart3 size={15} />
            <span>Balance Sheet & Net Worth</span>
          </button>
          <button
            type="button"
            className={`btn ${reportTab === 'pnl' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setReportTab('pnl')}
          >
            <DollarSign size={15} />
            <span>Income & Expense (P&L)</span>
          </button>
          <button
            type="button"
            className={`btn ${reportTab === 'payees' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setReportTab('payees')}
          >
            <Users size={15} />
            <span>Top Payees Analysis</span>
          </button>
        </div>

        {(reportTab === 'pnl' || reportTab === 'payees') && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>From:</span>
            <input
              type="date"
              className="form-input"
              style={{ width: '135px' }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>To:</span>
            <input
              type="date"
              className="form-input"
              style={{ width: '135px' }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <button type="button" className="btn btn-secondary" onClick={exportPnlCsv} disabled={!pnlReport}>
              <Download size={15} />
              <span>Export CSV</span>
            </button>
          </div>
        )}
      </div>

      {/* Tab 1: Balance Sheet & Net Worth */}
      {reportTab === 'balance' && (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Household Net Worth Statement</h2>
                <div className="panel-subtitle">
                  Exact balance sheet calculated from your local account registers
                </div>
              </div>
              <div className="tabular" style={{ fontWeight: 700, fontSize: '1.15rem' }}>
                Net Worth: {formatCents(summary.netWorthCents)}
              </div>
            </div>

            <div className="overview-grid" style={{ padding: 20 }}>
              <div>
                <h3 style={{ fontSize: '0.92rem', marginBottom: 10, color: 'var(--ink)' }}>
                  Assets ({formatCents(summary.assetsCents)})
                </h3>
                {positiveAccounts.length === 0 ? (
                  <p style={{ fontSize: '0.86rem', color: 'var(--ink-muted)' }}>
                    No positive-balance asset accounts recorded.
                  </p>
                ) : (
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Type</th>
                        <th className="num">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positiveAccounts.map((a) => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 500 }}>{a.name}</td>
                          <td style={{ color: 'var(--ink-secondary)' }}>
                            {accountTypeLabel(a.accountType)}
                          </td>
                          <td className="num" style={{ fontWeight: 600 }}>
                            {formatCents(a.currentBalanceCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <h3 style={{ fontSize: '0.92rem', marginBottom: 10, color: '#b91c1c' }}>
                  Liabilities ({summary.liabilitiesCents > 0 ? formatCents(-summary.liabilitiesCents) : '$0.00'})
                </h3>
                {debtAccounts.length === 0 ? (
                  <p style={{ fontSize: '0.86rem', color: 'var(--ink-muted)' }}>
                    No credit card or loan balances owed.
                  </p>
                ) : (
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Type</th>
                        <th className="num">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debtAccounts.map((a) => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 500 }}>{a.name}</td>
                          <td style={{ color: 'var(--ink-secondary)' }}>
                            {accountTypeLabel(a.accountType)}
                          </td>
                          <td className="num amt-negative" style={{ fontWeight: 600 }}>
                            {formatCents(a.currentBalanceCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>

          <div className="overview-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">
                    Spending by category ({formatMonthHeading(summary.month)})
                  </h2>
                  <div className="panel-subtitle tabular">
                    Total monthly spending: {formatCents(summary.monthExpenseCents)}
                  </div>
                </div>
              </div>

              {summary.topSpendingCategories.length === 0 ? (
                <div className="panel-body" style={{ color: 'var(--ink-muted)' }}>
                  No expenses recorded in {formatMonthHeading(summary.month)}.
                </div>
              ) : (
                <div className="ledger-table-wrap">
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="num">Entries</th>
                        <th className="num">Share</th>
                        <th className="num">Spent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topSpendingCategories.map((cat) => (
                        <tr key={cat.categoryId}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                              <span className="chip-dot" style={{ backgroundColor: cat.color }} />
                              <span>{cat.categoryName}</span>
                            </div>
                          </td>
                          <td className="num" style={{ color: 'var(--ink-secondary)' }}>
                            {cat.transactionCount}
                          </td>
                          <td className="num" style={{ color: 'var(--ink-secondary)' }}>
                            {cat.percentage.toFixed(1)}%
                          </td>
                          <td className="num" style={{ fontWeight: 650 }}>
                            {formatCents(cat.amountCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Six-Month Cash Flow Ledger</h2>
                  <div className="panel-subtitle">Transfers between accounts excluded</div>
                </div>
              </div>
              <div className="ledger-table-wrap">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="num">Income</th>
                      <th className="num">Spending</th>
                      <th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.monthlyTrends.map((m) => (
                      <tr key={m.month}>
                        <td style={{ fontWeight: 500 }}>{m.label}</td>
                        <td className="num amt-positive">{formatCents(m.incomeCents)}</td>
                        <td className="num">{formatCents(m.expenseCents)}</td>
                        <td
                          className={`num ${m.netCents >= 0 ? 'amt-positive' : 'amt-negative'}`}
                          style={{ fontWeight: 650 }}
                        >
                          {formatCents(m.netCents, { showPlus: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}

      {/* Tab 2: Custom Date Range P&L Statement */}
      {reportTab === 'pnl' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Income & Expense Statement (P&L)</h2>
              <div className="panel-subtitle">
                Period: {startDate} through {endDate}
              </div>
            </div>
            {pnlReport && (
              <div className="tabular" style={{ fontWeight: 700, fontSize: '1.15rem' }}>
                Net Savings: {formatCents(pnlReport.netSavingsCents, { showPlus: true })} ({pnlReport.savingsRatePercent.toFixed(1)}%)
              </div>
            )}
          </div>

          <div style={{ padding: 20 }}>
            {pnlLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>Loading Statement...</div>
            ) : !pnlReport ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--ink-muted)' }}>
                Select a valid date range to compute the Income Statement.
              </div>
            ) : (
              <>
                <div className="kpi-grid" style={{ marginBottom: 24 }}>
                  <div className="kpi-card">
                    <div className="kpi-label">Total Period Income</div>
                    <div className="kpi-value amt-positive" style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatCents(pnlReport.totalIncomeCents)}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Total Period Expenses</div>
                    <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatCents(pnlReport.totalExpenseCents)}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Net Surplus / Savings</div>
                    <div
                      className={`kpi-value ${pnlReport.netSavingsCents >= 0 ? 'amt-positive' : 'amt-negative'}`}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {formatCents(pnlReport.netSavingsCents, { showPlus: true })}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Savings Rate</div>
                    <div className="kpi-value">{pnlReport.savingsRatePercent.toFixed(1)}%</div>
                  </div>
                </div>

                <h3 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Expense Allocation by Category</h3>
                <div className="ledger-table-wrap">
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="num">Spent</th>
                        <th className="num">Share (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pnlReport.categoryBreakdown.map((cat) => (
                        <tr key={cat.categoryId}>
                          <td style={{ fontWeight: 500 }}>{cat.categoryName}</td>
                          <td className="num" style={{ fontWeight: 600 }}>
                            {formatCents(cat.amountCents)}
                          </td>
                          <td className="num" style={{ color: 'var(--ink-secondary)' }}>
                            {cat.percentage.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Tab 3: Top Payees Analysis */}
      {reportTab === 'payees' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Top Payees Spending Analysis</h2>
              <div className="panel-subtitle">
                Ranked by cumulative disbursements between {startDate} and {endDate}
              </div>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {pnlLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>Loading Payees...</div>
            ) : !pnlReport || pnlReport.topPayees.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--ink-muted)' }}>
                No payee disbursements found in this period.
              </div>
            ) : (
              <div className="ledger-table-wrap">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>Payee Name</th>
                      <th className="num" style={{ width: '120px' }}>Transactions</th>
                      <th className="num" style={{ width: '150px' }}>Average / Tx</th>
                      <th className="num" style={{ width: '170px' }}>Total Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnlReport.topPayees.map((p, idx) => (
                      <tr key={idx}>
                        <td style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{p.payee}</td>
                        <td className="num" style={{ color: 'var(--ink-secondary)' }}>{p.transactionCount}</td>
                        <td className="num" style={{ fontFamily: 'var(--font-mono)' }}>
                          {formatCents(p.averageSpentCents)}
                        </td>
                        <td className="num" style={{ fontWeight: 650, fontFamily: 'var(--font-mono)' }}>
                          {formatCents(p.totalSpentCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
