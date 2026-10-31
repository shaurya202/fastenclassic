import { useState, useEffect, useCallback, useId } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type {
  Account,
  InvestmentAction,
  PortfolioSummary,
  RecordInvestmentTxInput,
  Security,
} from '../types';
import { api } from '../lib/api';
import { formatCents, getTodayIso, parseCurrencyInput } from '../lib/format';

interface PortfolioViewProps {
  accounts: Account[];
  onNotify: (msg: string) => void;
}

export function PortfolioView({ accounts, onNotify }: PortfolioViewProps) {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [securities, setSecurities] = useState<Security[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  // Modal form state
  const [txAccountId, setTxAccountId] = useState<string>('');
  const [txSecurityId, setTxSecurityId] = useState<string>('');
  const [txAction, setTxAction] = useState<InvestmentAction>('buy');
  const [txDate, setTxDate] = useState<string>(getTodayIso());
  const [txShares, setTxShares] = useState<string>('1.000');
  const [txPrice, setTxPrice] = useState<string>('100.00');
  const [txCommission, setTxCommission] = useState<string>('0.00');
  const [txMemo, setTxMemo] = useState<string>('');

  const investmentAccounts = accounts.filter(
    (a) => a.accountType === 'investment'
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [summary, secList] = await Promise.all([
        api.getPortfolioSummary(),
        api.listSecurities(),
      ]);
      setPortfolio(summary);
      setSecurities(secList);
    } catch (err) {
      console.error('Failed to load portfolio:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openRecordModal() {
    if (investmentAccounts.length > 0 && !txAccountId) {
      setTxAccountId(investmentAccounts[0].id);
    } else if (accounts.length > 0 && !txAccountId) {
      setTxAccountId(accounts[0].id);
    }
    if (securities.length > 0 && !txSecurityId) {
      setTxSecurityId(securities[0].id);
    }
    setModalOpen(true);
  }

  async function handleRecordTx(e: React.FormEvent) {
    e.preventDefault();
    if (!txAccountId || !txSecurityId) {
      onNotify('Please select an account and security.');
      return;
    }

    const sharesNum = parseFloat(txShares) || 0;
    const sharesMicros = Math.round(sharesNum * 1_000_000);
    const pricePerShareCents = parseCurrencyInput(txPrice) || 0;
    const commissionCents = parseCurrencyInput(txCommission) || 0;

    const input: RecordInvestmentTxInput = {
      accountId: txAccountId,
      securityId: txSecurityId,
      action: txAction,
      txDate,
      sharesMicros,
      pricePerShareCents,
      commissionCents,
      memo: txMemo.trim() || undefined,
    };

    try {
      await api.recordInvestmentTx(input);
      onNotify('Investment transaction recorded.');
      setModalOpen(false);
      setTxMemo('');
      await loadData();
    } catch (err) {
      onNotify(`Error: ${String(err)}`);
    }
  }

  const modalTitleId = useId();

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2 className="view-title">Investment Portfolio & Holdings</h2>
          <p className="view-subtitle">
            Track stocks, ETFs, mutual funds, cost basis, and unrealized gains across your accounts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={loadData} title="Refresh">
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={openRecordModal}>
            <Plus size={15} />
            <span>Record Investment Tx</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: '24px' }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Portfolio Value</div>
          <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatCents(portfolio?.totalMarketValueCents ?? 0)}
          </div>
          <div className="kpi-subtext">Current market value of all held assets</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Total Cost Basis</div>
          <div className="kpi-value" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatCents(portfolio?.totalCostBasisCents ?? 0)}
          </div>
          <div className="kpi-subtext">Cumulative purchase cost</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Unrealized Gain / Loss</div>
          <div
            className="kpi-value"
            style={{
              fontFamily: 'var(--font-mono)',
              color: (portfolio?.totalUnrealizedGainCents ?? 0) >= 0 ? 'var(--ink)' : '#b91c1c',
            }}
          >
            {(portfolio?.totalUnrealizedGainCents ?? 0) >= 0 ? '+' : ''}
            {formatCents(portfolio?.totalUnrealizedGainCents ?? 0)}
          </div>
          <div className="kpi-subtext">
            {portfolio?.totalCostBasisCents
              ? `${(((portfolio.totalUnrealizedGainCents || 0) / portfolio.totalCostBasisCents) * 100).toFixed(2)}% overall return`
              : '0.00% return'}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Active Holdings</div>
          <div className="kpi-value">{portfolio?.holdings.length ?? 0}</div>
          <div className="kpi-subtext">Securities with non-zero shares</div>
        </div>
      </div>

      {/* Holdings Table */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Securities & Holdings</h3>
          <span className="badge badge-subtle">{portfolio?.holdings.length ?? 0} positions</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Symbol</th>
                <th>Security Name</th>
                <th style={{ width: '90px' }}>Type</th>
                <th style={{ textAlign: 'right', width: '110px' }}>Shares</th>
                <th style={{ textAlign: 'right', width: '110px' }}>Avg Cost</th>
                <th style={{ textAlign: 'right', width: '110px' }}>Current Price</th>
                <th style={{ textAlign: 'right', width: '120px' }}>Cost Basis</th>
                <th style={{ textAlign: 'right', width: '130px' }}>Market Value</th>
                <th style={{ textAlign: 'right', width: '140px' }}>Gain / Loss</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '24px' }}>
                    Loading portfolio holdings...
                  </td>
                </tr>
              ) : !portfolio || portfolio.holdings.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-muted)' }}>
                    No investment positions found. Record a Buy transaction to track securities.
                  </td>
                </tr>
              ) : (
                portfolio.holdings.map((h) => {
                  const shares = (h.totalSharesMicros / 1_000_000).toFixed(3);
                  const isGain = h.unrealizedGainCents >= 0;
                  return (
                    <tr key={h.securityId}>
                      <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{h.symbol}</td>
                      <td>{h.name}</td>
                      <td>
                        <span className="badge badge-subtle" style={{ textTransform: 'uppercase', fontSize: '0.72rem' }}>
                          {h.securityType}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{shares}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {formatCents(h.avgCostPerShareCents)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {formatCents(h.currentPriceCents)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {formatCents(h.totalCostCents)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {formatCents(h.marketValueCents)}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 500,
                          color: isGain ? 'var(--ink)' : '#b91c1c',
                        }}
                      >
                        {isGain ? '+' : ''}
                        {formatCents(h.unrealizedGainCents)} ({isGain ? '+' : ''}
                        {h.unrealizedGainPercent.toFixed(2)}%)
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Investment Transactions History */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Recent Investment Transactions</h3>
          <span className="badge badge-subtle">{portfolio?.transactions.length ?? 0} transactions</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Date</th>
                <th style={{ width: '90px' }}>Action</th>
                <th style={{ width: '80px' }}>Symbol</th>
                <th>Security Name</th>
                <th style={{ textAlign: 'right', width: '100px' }}>Shares</th>
                <th style={{ textAlign: 'right', width: '110px' }}>Price</th>
                <th style={{ textAlign: 'right', width: '120px' }}>Total Amount</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {!portfolio || portfolio.transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-muted)' }}>
                    No investment transactions recorded yet.
                  </td>
                </tr>
              ) : (
                portfolio.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{tx.txDate}</td>
                    <td>
                      <span className="badge badge-subtle" style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                        {tx.action}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{tx.securitySymbol || '-'}</td>
                    <td>{tx.securityName || '-'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {(tx.sharesMicros / 1_000_000).toFixed(3)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {formatCents(tx.pricePerShareCents)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {formatCents(tx.totalAmountCents)}
                    </td>
                    <td style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>{tx.memo || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Investment Tx Modal */}
      {modalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={modalTitleId}>
          <div className="modal">
            <div className="modal-header">
              <h2 id={modalTitleId} className="modal-title">Record Investment Transaction</h2>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <form onSubmit={handleRecordTx}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="inv-acc">Account</label>
                  <select
                    id="inv-acc"
                    className="form-input"
                    value={txAccountId}
                    onChange={(e) => setTxAccountId(e.target.value)}
                    required
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.accountType})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-action">Action</label>
                    <select
                      id="inv-action"
                      className="form-input"
                      value={txAction}
                      onChange={(e) => setTxAction(e.target.value as InvestmentAction)}
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                      <option value="dividend">Dividend</option>
                      <option value="reinvest">Reinvest</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-date">Date</label>
                    <input
                      id="inv-date"
                      type="date"
                      className="form-input"
                      value={txDate}
                      onChange={(e) => setTxDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="inv-sec">Security</label>
                  <select
                    id="inv-sec"
                    className="form-input"
                    value={txSecurityId}
                    onChange={(e) => setTxSecurityId(e.target.value)}
                    required
                  >
                    {securities.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.symbol} - {s.name} ({s.securityType})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-shares">Shares</label>
                    <input
                      id="inv-shares"
                      type="number"
                      step="0.001"
                      className="form-input"
                      style={{ fontFamily: 'var(--font-mono)' }}
                      value={txShares}
                      onChange={(e) => setTxShares(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-price">Price / Share ($)</label>
                    <input
                      id="inv-price"
                      type="text"
                      className="form-input"
                      style={{ fontFamily: 'var(--font-mono)' }}
                      value={txPrice}
                      onChange={(e) => setTxPrice(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-comm">Commission ($)</label>
                    <input
                      id="inv-comm"
                      type="text"
                      className="form-input"
                      style={{ fontFamily: 'var(--font-mono)' }}
                      value={txCommission}
                      onChange={(e) => setTxCommission(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-memo">Memo</label>
                    <input
                      id="inv-memo"
                      type="text"
                      className="form-input"
                      placeholder="Optional notes"
                      value={txMemo}
                      onChange={(e) => setTxMemo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
