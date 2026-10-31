import { useState, useEffect, useCallback } from 'react';
import { Calculator, Zap, Download, RefreshCw } from 'lucide-react';
import type { LoanCalculation, LoanPayoffComparison } from '../types';
import { api } from '../lib/api';
import { formatCents, parseCurrencyInput } from '../lib/format';

interface LoanCalculatorViewProps {
  onNotify: (msg: string) => void;
}

export function LoanCalculatorView({ onNotify }: LoanCalculatorViewProps) {
  // Default: $350,000 mortgage at 6.25% for 30 years (360 months) with $250 extra
  const [principalInput, setPrincipalInput] = useState<string>('350,000');
  const [aprInput, setAprInput] = useState<string>('6.25');
  const [termMonths, setTermMonths] = useState<number>(360);
  const [extraInput, setExtraInput] = useState<string>('250');

  const [calculation, setCalculation] = useState<LoanCalculation | null>(null);
  const [comparison, setComparison] = useState<LoanPayoffComparison | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const calculate = useCallback(async () => {
    const principalCents = (parseCurrencyInput(principalInput) || 0);
    const aprPercent = parseFloat(aprInput) || 0;
    const aprBasisPoints = Math.round(aprPercent * 100);
    const extraMonthlyCents = (parseCurrencyInput(extraInput) || 0);

    if (principalCents <= 0 || termMonths <= 0) return;

    setLoading(true);
    try {
      const [calc, comp] = await Promise.all([
        api.calculateLoanAmortization(principalCents, aprBasisPoints, termMonths, extraMonthlyCents),
        api.compareLoanPayoff(principalCents, aprBasisPoints, termMonths, extraMonthlyCents),
      ]);
      setCalculation(calc);
      setComparison(comp);
    } catch (err) {
      console.error('Failed to calculate loan amortization:', err);
    } finally {
      setLoading(false);
    }
  }, [principalInput, aprInput, termMonths, extraInput]);

  useEffect(() => {
    void calculate();
  }, [calculate]);

  function handleExportCsv() {
    if (!calculation) return;
    const rows = [
      ['Loan Principal ($)', (calculation.principalCents / 100).toFixed(2)],
      ['APR (%)', (calculation.interestRateBasisPoints / 100).toFixed(2)],
      ['Term (Months)', calculation.termMonths.toString()],
      ['Monthly Payment ($)', (calculation.monthlyPaymentCents / 100).toFixed(2)],
      ['Total Interest Paid ($)', (calculation.totalInterestCents / 100).toFixed(2)],
      ['Total Paid ($)', (calculation.totalPaidCents / 100).toFixed(2)],
      [],
      ['Month #', 'Payment ($)', 'Principal ($)', 'Interest ($)', 'Remaining Balance ($)'],
      ...calculation.schedule.map((m) => [
        m.monthIndex.toString(),
        (m.paymentCents / 100).toFixed(2),
        (m.principalCents / 100).toFixed(2),
        (m.interestCents / 100).toFixed(2),
        (m.remainingBalanceCents / 100).toFixed(2),
      ]),
    ];

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `FastenClassic_Amortization_Schedule.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onNotify('Amortization schedule exported to CSV.');
  }

  const extraMonthlyCents = parseCurrencyInput(extraInput) || 0;
  const hasExtra = extraMonthlyCents > 0 && (comparison?.monthsSaved ?? 0) > 0;

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2 className="view-title">Loan Amortization & Debt Payoff</h2>
          <p className="view-subtitle">
            Model mortgages, auto loans, and student loans with accelerated debt snowball & early payoff math.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={calculate} title="Recalculate">
            <RefreshCw size={15} />
            <span>Recalculate</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={handleExportCsv} disabled={!calculation}>
            <Download size={15} />
            <span>Export Amortization CSV</span>
          </button>
        </div>
      </div>

      {/* Input Parameters Form Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calculator size={18} />
            <h3 className="card-title">Loan Parameters</h3>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className={`btn btn-sm ${termMonths === 360 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTermMonths(360)}
            >
              30-Yr Mortgage
            </button>
            <button
              type="button"
              className={`btn btn-sm ${termMonths === 180 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTermMonths(180)}
            >
              15-Yr Mortgage
            </button>
            <button
              type="button"
              className={`btn btn-sm ${termMonths === 60 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTermMonths(60)}
            >
              5-Yr Auto
            </button>
            <button
              type="button"
              className={`btn btn-sm ${termMonths === 36 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTermMonths(36)}
            >
              3-Yr Loan
            </button>
          </div>
        </div>

        <div style={{ padding: '0 20px 20px 20px' }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="loan-principal">Principal Balance ($)</label>
              <input
                id="loan-principal"
                type="text"
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)' }}
                value={principalInput}
                onChange={(e) => setPrincipalInput(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="loan-apr">Interest Rate (APR %)</label>
              <input
                id="loan-apr"
                type="text"
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)' }}
                value={aprInput}
                onChange={(e) => setAprInput(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="loan-term">Term (Total Months)</label>
              <input
                id="loan-term"
                type="number"
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)' }}
                value={termMonths}
                onChange={(e) => setTermMonths(parseInt(e.target.value, 10) || 1)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="loan-extra">Extra Monthly Principal ($)</label>
              <input
                id="loan-extra"
                type="text"
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)' }}
                value={extraInput}
                onChange={(e) => setExtraInput(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Accelerated Payoff Callout */}
      {hasExtra && comparison && (
        <div
          className="card"
          style={{
            marginBottom: '24px',
            backgroundColor: 'var(--bg-subtle)',
            borderLeft: '4px solid var(--ink)',
            padding: '16px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <Zap size={18} style={{ color: 'var(--ink)' }} />
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Accelerated Payoff Advantage</h4>
          </div>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink)' }}>
            By applying an extra <strong>{formatCents(extraMonthlyCents)}/mo</strong> directly to principal: you will save{' '}
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatCents(comparison.interestSavedCents)}</strong> in total
            interest and pay off your loan <strong>{comparison.monthsSaved} months</strong> ({ (comparison.monthsSaved / 12).toFixed(1) } years) early!
          </p>
        </div>
      )}

      {/* Output KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: '24px' }}>
        <div className="kpi-card">
          <div className="kpi-label">Monthly Payment</div>
          <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatCents(calculation?.monthlyPaymentCents ?? 0)}
          </div>
          <div className="kpi-subtext">Principal + interest {hasExtra ? '(includes extra payment)' : ''}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Total Interest Paid</div>
          <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatCents(calculation?.totalInterestCents ?? 0)}
          </div>
          <div className="kpi-subtext">Cumulative finance charge</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Total Cost of Loan</div>
          <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatCents(calculation?.totalPaidCents ?? 0)}
          </div>
          <div className="kpi-subtext">Principal + interest combined</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Total Duration</div>
          <div className="kpi-value">{calculation?.schedule.length ?? 0} Months</div>
          <div className="kpi-subtext">
            {calculation ? `${(calculation.schedule.length / 12).toFixed(1)} years to payoff` : ''}
          </div>
        </div>
      </div>

      {/* Month-by-Month Amortization Schedule */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Month-by-Month Amortization Schedule</h3>
          <span className="badge badge-subtle">{calculation?.schedule.length ?? 0} payments</span>
        </div>
        <div className="table-wrapper" style={{ maxHeight: '480px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Month</th>
                <th style={{ textAlign: 'right', width: '130px' }}>Payment</th>
                <th style={{ textAlign: 'right', width: '140px' }}>Principal</th>
                <th style={{ textAlign: 'right', width: '140px' }}>Interest</th>
                <th style={{ textAlign: 'right', width: '160px' }}>Remaining Balance</th>
                <th>Principal / Interest Split</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px' }}>
                    Calculating schedule...
                  </td>
                </tr>
              ) : !calculation || calculation.schedule.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-muted)' }}>
                    Enter valid loan parameters above to generate amortization schedule.
                  </td>
                </tr>
              ) : (
                calculation.schedule.map((m) => {
                  const princPercent = m.paymentCents > 0
                    ? Math.round((m.principalCents / m.paymentCents) * 100)
                    : 0;
                  return (
                    <tr key={m.monthIndex}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>#{m.monthIndex}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {formatCents(m.paymentCents)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {formatCents(m.principalCents)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
                        {formatCents(m.interestCents)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {formatCents(m.remainingBalanceCents)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              width: '100px',
                              height: '8px',
                              backgroundColor: 'var(--border)',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              display: 'flex',
                            }}
                          >
                            <div
                              style={{
                                width: `${princPercent}%`,
                                backgroundColor: 'var(--ink)',
                                height: '100%',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                            {princPercent}% principal
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
