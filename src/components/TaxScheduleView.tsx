import { useState, useEffect, useCallback } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import type { TaxYearReport } from '../types';
import { api } from '../lib/api';
import { formatCents } from '../lib/format';

interface TaxScheduleViewProps {
  onNotify: (msg: string) => void;
}

export function TaxScheduleView({ onNotify }: TaxScheduleViewProps) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [report, setReport] = useState<TaxYearReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [filingStatus, setFilingStatus] = useState<'single' | 'married'>('married');

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTaxScheduleReport(selectedYear);
      setReport(data);
    } catch (err) {
      console.error('Failed to load tax schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const standardDeduction =
    filingStatus === 'single'
      ? report?.standardDeductionSingleCents ?? 1_500_000
      : report?.standardDeductionMarriedCents ?? 3_000_000;

  const totalItemized = report?.totalDeductionsCents ?? 0;
  const itemizeAdvantage = totalItemized - standardDeduction;
  const shouldItemize = itemizeAdvantage > 0;

  function handleExportCsv() {
    if (!report) return;
    const rows = [
      ['Tax Year', report.year.toString()],
      ['Filing Status', filingStatus],
      ['Total Itemized Deductions', (report.totalDeductionsCents / 100).toFixed(2)],
      ['Standard Deduction', (standardDeduction / 100).toFixed(2)],
      ['Total Taxable Income', (report.totalTaxableIncomeCents / 100).toFixed(2)],
      [],
      ['Schedule', 'Category', 'Transaction Count', 'Total Amount ($)'],
      ...report.schedules.map((s) => [
        `"${s.scheduleName}"`,
        `"${s.categoryName}"`,
        s.transactionCount.toString(),
        (s.totalAmountCents / 100).toFixed(2),
      ]),
      [],
      ['Date', 'Payee', 'Category', 'Amount ($)', 'Memo'],
      ...report.transactions.map((t) => [
        t.postedDate,
        `"${t.payee}"`,
        `"${t.categoryName || 'Uncategorized'}"`,
        (t.amountCents / 100).toFixed(2),
        `"${t.memo || ''}"`,
      ]),
    ];

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `FastenClassic_Tax_Schedule_${selectedYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onNotify(`Tax report for ${selectedYear} exported to CSV.`);
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2 className="view-title">Tax Schedule & Itemized Deductions</h2>
          <p className="view-subtitle">
            Quicken-compatible tax schedule reporting for Schedule A, Schedule C, 1099s, and deduction optimization.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ width: '110px', fontWeight: 600 }}
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
          >
            <option value={currentYear}>{currentYear}</option>
            <option value={currentYear - 1}>{currentYear - 1}</option>
            <option value={currentYear - 2}>{currentYear - 2}</option>
          </select>
          <button type="button" className="btn btn-secondary" onClick={loadReport} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button type="button" className="btn btn-primary" onClick={handleExportCsv} disabled={!report}>
            <Download size={15} />
            <span>Export Tax CSV</span>
          </button>
        </div>
      </div>

      {/* Deduction Strategy Card */}
      <div
        className="card"
        style={{
          marginBottom: '24px',
          borderLeft: shouldItemize ? '4px solid var(--ink)' : '4px solid var(--border)',
        }}
      >
        <div className="card-header" style={{ paddingBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} />
            <h3 className="card-title">Deduction Optimizer ({selectedYear})</h3>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className={`btn btn-sm ${filingStatus === 'married' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilingStatus('married')}
            >
              Married Filing Jointly
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filingStatus === 'single' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilingStatus('single')}
            >
              Single
            </button>
          </div>
        </div>
        <div style={{ padding: '0 20px 20px 20px' }}>
          <div className="kpi-grid" style={{ marginBottom: '16px' }}>
            <div className="kpi-card">
              <div className="kpi-label">Itemized Deductions</div>
              <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatCents(totalItemized)}
              </div>
              <div className="kpi-subtext">Sum of eligible Schedule A/C expenses</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Standard Deduction ({filingStatus === 'single' ? 'Single' : 'MFJ'})</div>
              <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatCents(standardDeduction)}
              </div>
              <div className="kpi-subtext">IRS baseline deduction allowance</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Recommendation</div>
              <div className="kpi-value" style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                {shouldItemize ? 'Itemize Deductions' : 'Take Standard Deduction'}
              </div>
              <div className="kpi-subtext">
                {shouldItemize
                  ? `Itemizing provides an extra ${formatCents(itemizeAdvantage)} deduction`
                  : `Standard deduction saves ${formatCents(-itemizeAdvantage)} more than itemizing`}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Taxable Income</div>
              <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatCents(report?.totalTaxableIncomeCents ?? 0)}
              </div>
              <div className="kpi-subtext">1099, salary, & interest income</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tax Schedules Breakdown */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">IRS Tax Schedule Allocations</h3>
          <span className="badge badge-subtle">{report?.schedules.length ?? 0} tax lines</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '280px' }}>Tax Schedule</th>
                <th>Category</th>
                <th style={{ textAlign: 'right', width: '120px' }}>Transactions</th>
                <th style={{ textAlign: 'right', width: '160px' }}>Total Amount ($)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '24px' }}>
                    Loading tax schedule data...
                  </td>
                </tr>
              ) : !report || report.schedules.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-muted)' }}>
                    No tax-scheduled categories found. Edit categories in "Rules & Categories" to assign tax schedules.
                  </td>
                </tr>
              ) : (
                report.schedules.map((s, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600 }}>{s.scheduleName}</td>
                    <td>{s.categoryName}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.transactionCount}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {formatCents(s.totalAmountCents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Matching Tax Transactions */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Tax-Deductible Transactions ({selectedYear})</h3>
          <span className="badge badge-subtle">{report?.transactions.length ?? 0} records</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Date</th>
                <th>Payee</th>
                <th style={{ width: '200px' }}>Category</th>
                <th style={{ textAlign: 'right', width: '130px' }}>Amount</th>
                <th>Memo / Reference</th>
              </tr>
            </thead>
            <tbody>
              {!report || report.transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-muted)' }}>
                    No transactions matching tax schedules for {selectedYear}.
                  </td>
                </tr>
              ) : (
                report.transactions.slice(0, 50).map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{t.postedDate}</td>
                    <td style={{ fontWeight: 500 }}>{t.payee}</td>
                    <td>
                      <span className="badge badge-subtle">{t.categoryName || 'Uncategorized'}</span>
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: t.amountCents >= 0 ? 'var(--ink)' : '#b91c1c',
                      }}
                    >
                      {formatCents(t.amountCents)}
                    </td>
                    <td style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>{t.memo || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
