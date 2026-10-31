import { useState, useEffect, useCallback } from 'react';
import { Printer } from 'lucide-react';
import type { Account, Transaction } from '../types';
import { api } from '../lib/api';
import { formatCents, getTodayIso, parseCurrencyInput } from '../lib/format';

interface CheckPrintingViewProps {
  accounts: Account[];
  onNotify: (msg: string) => void;
}

export function CheckPrintingView({ accounts, onNotify }: CheckPrintingViewProps) {
  const checkingAccounts = accounts.filter(
    (a) => a.accountType === 'checking' || a.accountType === 'cash'
  );

  const [selectedAccountId, setSelectedAccountId] = useState<string>(() => {
    return checkingAccounts.length > 0 ? checkingAccounts[0].id : (accounts[0]?.id ?? '');
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // Check form fields
  const [checkNumber, setCheckNumber] = useState<string>('1042');
  const [checkDate, setCheckDate] = useState<string>(getTodayIso());
  const [payee, setPayee] = useState<string>('City Water & Sewer Utility');
  const [amountInput, setAmountInput] = useState<string>('124.50');
  const [memo, setMemo] = useState<string>('Account #8841-29 - Nov Bill');
  const [legalWords, setLegalWords] = useState<string>('One Hundred Twenty-Four and 50/100 Dollars');
  const [checkLayout, setCheckLayout] = useState<'voucher' | 'wallet'>('voucher');

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  const loadTransactions = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      const txs = await api.listTransactions({ accountId: selectedAccountId });
      // Only keep expenses / checks
      const expenseTxs = txs.filter((t) => t.amountCents < 0);
      setTransactions(expenseTxs);
      if (expenseTxs.length > 0 && !selectedTx) {
        selectTransactionForCheck(expenseTxs[0]);
      }
    } catch (err) {
      console.error('Failed to load transactions for check printing:', err);
    }
  }, [selectedAccountId, selectedTx]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const updateWords = useCallback(async (cents: number) => {
    try {
      const words = await api.convertNumberToEnglishWords(cents);
      setLegalWords(words);
    } catch {
      setLegalWords(`${(cents / 100).toFixed(2)} Dollars`);
    }
  }, []);

  function selectTransactionForCheck(tx: Transaction) {
    setSelectedTx(tx);
    setPayee(tx.payee);
    setCheckDate(tx.postedDate);
    const absCents = Math.abs(tx.amountCents);
    setAmountInput((absCents / 100).toFixed(2));
    setMemo(tx.memo || '');
    if (tx.checkNumber) {
      setCheckNumber(tx.checkNumber);
    }
    void updateWords(absCents);
  }

  function handleAmountChange(val: string) {
    setAmountInput(val);
    const cents = parseCurrencyInput(val) || 0;
    void updateWords(cents);
  }

  function handlePrint() {
    window.print();
    onNotify(`Check #${checkNumber} sent to printer.`);
  }

  return (
    <div className="view-container">
      {/* Top Controls - Hidden during print */}
      <div className="view-header print-hide">
        <div>
          <h2 className="view-title">Check Printing & Disbursement Register</h2>
          <p className="view-subtitle">
            Print standard bank checks on continuous or laser voucher check stock with legal English amount conversion.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ width: '150px' }}
            value={checkLayout}
            onChange={(e) => setCheckLayout(e.target.value as 'voucher' | 'wallet')}
          >
            <option value="voucher">Voucher Check (Top)</option>
            <option value="wallet">Personal 3-Per-Page</option>
          </select>
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            <Printer size={15} />
            <span>Print Check</span>
          </button>
        </div>
      </div>

      {/* Editor & Register split - Hidden during print */}
      <div className="print-hide" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        {/* Check Fields Editor */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Check Details</h3>
            <span className="badge badge-subtle">Check #{checkNumber}</span>
          </div>
          <div style={{ padding: '0 20px 20px 20px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="check-account">Bank Account</label>
              <select
                id="check-account"
                className="form-input"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                {checkingAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.institution || 'Bank'})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="check-num">Check Number</label>
                <input
                  id="check-num"
                  type="text"
                  className="form-input"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  value={checkNumber}
                  onChange={(e) => setCheckNumber(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="check-date">Date</label>
                <input
                  id="check-date"
                  type="date"
                  className="form-input"
                  value={checkDate}
                  onChange={(e) => setCheckDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="check-payee">Pay to the Order of</label>
              <input
                id="check-payee"
                type="text"
                className="form-input"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="check-amt">Amount ($)</label>
              <input
                id="check-amt"
                type="text"
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)' }}
                value={amountInput}
                onChange={(e) => handleAmountChange(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="check-memo">Memo</label>
              <input
                id="check-memo"
                type="text"
                className="form-input"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Candidate Transactions Register */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Select from Register</h3>
            <span className="badge badge-subtle">{transactions.length} disbursements</span>
          </div>
          <div className="table-wrapper" style={{ maxHeight: '315px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '90px' }}>Date</th>
                  <th>Payee</th>
                  <th style={{ textAlign: 'right', width: '100px' }}>Amount</th>
                  <th style={{ width: '70px' }}></th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-muted)' }}>
                      No payments found in selected account.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      style={{
                        backgroundColor: selectedTx?.id === tx.id ? 'var(--bg-subtle)' : undefined,
                      }}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{tx.postedDate}</td>
                      <td style={{ fontWeight: 500 }}>{tx.payee}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {formatCents(Math.abs(tx.amountCents))}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => selectTransactionForCheck(tx)}
                        >
                          Use
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Live Printable Check Preview */}
      <div className="card check-preview-container" style={{ padding: '24px' }}>
        <div className="card-header print-hide" style={{ padding: 0, marginBottom: '16px' }}>
          <h3 className="card-title">Laser Check Preview ({checkLayout === 'voucher' ? 'Standard Voucher' : '3-to-Page'})</h3>
          <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>Formatted for standard Letter / Bank paper</span>
        </div>

        {/* The Physical Check Face */}
        <div
          className="check-face"
          style={{
            border: '2px solid #222',
            borderRadius: '4px',
            padding: '24px 28px',
            backgroundColor: '#ffffff',
            color: '#111111',
            fontFamily: 'serif',
            position: 'relative',
            maxWidth: '750px',
            margin: '0 auto',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          {/* Header Row: Payer Name & Check # */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '1.05rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {selectedAccount?.institution || 'FIRST NATIONAL BANK'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#444' }}>
                Primary Checking Account &bull; {selectedAccount?.name || 'Household Checking'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>
                {checkNumber}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#555' }}>68-420 / 810</div>
            </div>
          </div>

          {/* Date Row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 'bold', textTransform: 'uppercase' }}>DATE:</span>
              <span
                style={{
                  borderBottom: '1px solid #111',
                  minWidth: '130px',
                  display: 'inline-block',
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.95rem',
                  paddingBottom: '2px',
                }}
              >
                {checkDate}
              </span>
            </div>
          </div>

          {/* Pay To Order & Dollar Box Row */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '18px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              PAY TO THE<br />ORDER OF:
            </span>
            <span
              style={{
                flex: 1,
                borderBottom: '1px solid #111',
                paddingBottom: '2px',
                fontSize: '1.15rem',
                fontWeight: 600,
                fontFamily: 'sans-serif',
              }}
            >
              {payee || '__________________________________'}
            </span>
            <div
              style={{
                border: '1.5px solid #111',
                padding: '6px 12px',
                fontWeight: 'bold',
                fontSize: '1.15rem',
                fontFamily: 'var(--font-mono)',
                backgroundColor: '#fafafa',
                minWidth: '130px',
                textAlign: 'right',
              }}
            >
              ${amountInput || '0.00'}
            </div>
          </div>

          {/* Legal English Written Words Line */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '28px' }}>
            <span
              style={{
                flex: 1,
                borderBottom: '1px solid #111',
                paddingBottom: '2px',
                fontSize: '0.98rem',
                fontStyle: 'italic',
                fontWeight: 500,
              }}
            >
              {legalWords || 'Zero and 00/100 Dollars'}
            </span>
          </div>

          {/* Memo & Authorized Signature Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', width: '50%' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>MEMO:</span>
              <span
                style={{
                  borderBottom: '1px solid #111',
                  flex: 1,
                  display: 'inline-block',
                  paddingBottom: '2px',
                  fontSize: '0.85rem',
                  fontFamily: 'sans-serif',
                }}
              >
                {memo || ''}
              </span>
            </div>
            <div style={{ width: '40%', textAlign: 'center' }}>
              <div style={{ borderBottom: '1px solid #111', height: '24px', marginBottom: '4px' }}></div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                AUTHORIZED SIGNATURE
              </span>
            </div>
          </div>

          {/* MICR Encoding Line */}
          <div
            style={{
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '1.05rem',
              letterSpacing: '2px',
              borderTop: '1px dashed #ddd',
              paddingTop: '12px',
              color: '#333',
            }}
          >
            ⑆123456789⑆ 987654321⑈ {checkNumber}
          </div>
        </div>

        {/* Voucher Stubs (for Business Voucher Layout) */}
        {checkLayout === 'voucher' && (
          <div className="voucher-stubs" style={{ maxWidth: '750px', margin: '24px auto 0 auto' }}>
            <div
              style={{
                border: '1px dashed #aaa',
                padding: '16px',
                borderRadius: '4px',
                marginBottom: '16px',
                fontSize: '0.85rem',
                backgroundColor: '#fcfcfc',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>REMITTANCE ADVICE (PAYEE COPY)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>Check #: <strong>{checkNumber}</strong></div>
                <div>Date: <strong>{checkDate}</strong></div>
                <div>Payee: <strong>{payee}</strong></div>
                <div>Amount: <strong>${amountInput}</strong></div>
              </div>
              <div style={{ marginTop: '6px', color: '#555' }}>Memo: {memo || 'N/A'}</div>
            </div>

            <div
              style={{
                border: '1px dashed #aaa',
                padding: '16px',
                borderRadius: '4px',
                fontSize: '0.85rem',
                backgroundColor: '#fcfcfc',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>PAYER RECORD (FILE COPY)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>Check #: <strong>{checkNumber}</strong></div>
                <div>Date: <strong>{checkDate}</strong></div>
                <div>Payee: <strong>{payee}</strong></div>
                <div>Amount: <strong>${amountInput}</strong></div>
              </div>
              <div style={{ marginTop: '6px', color: '#555' }}>Memo: {memo || 'N/A'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
