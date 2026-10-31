import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileUp, Plus } from 'lucide-react';
import type { Account, Category, DashboardSummary, NavSection } from './types';
import { api } from './lib/api';
import {
  formatMonthHeading,
  getCurrentMonthIso,
  getTodayIso,
  shiftMonth,
} from './lib/format';
import { Sidebar } from './components/Sidebar';
import { AccountModal } from './components/AccountModal';
import { OverviewView } from './components/OverviewView';
import { TransactionsView } from './components/TransactionsView';
import { ImportView } from './components/ImportView';
import { BudgetsView } from './components/BudgetsView';
import { BillsView } from './components/BillsView';
import { ReportsView } from './components/ReportsView';
import { RulesView } from './components/RulesView';
import { BackupView } from './components/BackupView';
import { PortfolioView } from './components/PortfolioView';
import { TaxScheduleView } from './components/TaxScheduleView';
import { LoanCalculatorView } from './components/LoanCalculatorView';
import { CheckPrintingView } from './components/CheckPrintingView';

const NAV_TITLES: Record<NavSection, string> = {
  overview: 'Household overview',
  transactions: 'Transactions',
  portfolio: 'Investment portfolio & holdings',
  import: 'Import statement',
  budgets: 'Monthly budget',
  bills: 'Bills & reminders',
  tax: 'Tax schedule & deductions',
  loans: 'Loan amortization & payoff',
  checks: 'Check printing & register',
  reports: 'Financial reports & P&L',
  rules: 'Rules & categories',
  backup: 'Backup & local data',
};

export function App() {
  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthIso());
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // Register navigation presets
  const [txAccountFilter, setTxAccountFilter] = useState('');
  const [txUncategorizedOnly, setTxUncategorizedOnly] = useState(false);

  // Account modal
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Toast notification
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshAll = useCallback(async () => {
    const [dash, cats] = await Promise.all([
      api.getDashboardSummary(selectedMonth, getTodayIso()),
      api.listCategories(),
    ]);
    setSummary(dash);
    setCategories(cats);
  }, [selectedMonth]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Keyboard shortcuts: Ctrl/Cmd+I -> Import statement
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setActiveNav('import');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const dueSoonBillsCount =
    summary?.upcomingBills.filter((b) => b.status === 'overdue' || b.status === 'due_soon')
      .length ?? 0;

  return (
    <div className="app-shell">
      <Sidebar
        activeNav={activeNav}
        onSelectNav={(nav) => {
          if (nav === 'transactions') {
            setTxAccountFilter('');
            setTxUncategorizedOnly(false);
          }
          setActiveNav(nav);
        }}
        accounts={summary?.accounts ?? []}
        uncategorizedCount={summary?.uncategorizedCount ?? 0}
        dueSoonBillsCount={dueSoonBillsCount}
        onSelectAccountTransactions={(accId) => {
          setTxAccountFilter(accId);
          setTxUncategorizedOnly(false);
          setActiveNav('transactions');
        }}
        onAddAccount={() => {
          setEditingAccount(null);
          setAccountModalOpen(true);
        }}
        onEditAccount={(acc) => {
          setEditingAccount(acc);
          setAccountModalOpen(true);
        }}
      />

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="page-title">{NAV_TITLES[activeNav]}</h1>

            {(activeNav === 'overview' ||
              activeNav === 'budgets' ||
              activeNav === 'reports' ||
              activeNav === 'transactions') && (
              <div className="month-switcher" role="group" aria-label="Selected month">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Previous month"
                  onClick={() => setSelectedMonth((m) => shiftMonth(m, -1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="month-switcher-label">{formatMonthHeading(selectedMonth)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Next month"
                  onClick={() => setSelectedMonth((m) => shiftMonth(m, 1))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditingAccount(null);
                setAccountModalOpen(true);
              }}
            >
              <Plus size={16} />
              <span>Add account</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setActiveNav('import')}
            >
              <FileUp size={16} />
              <span>Import statement</span>
            </button>
          </div>
        </header>

        <main className="workspace-body">
          {!summary ? (
            <div className="panel">
              <div className="panel-body">Opening local household ledger...</div>
            </div>
          ) : (
            <>
              {activeNav === 'overview' && (
                <OverviewView
                  summary={summary}
                  onNavigate={setActiveNav}
                  onOpenAddAccount={() => {
                    setEditingAccount(null);
                    setAccountModalOpen(true);
                  }}
                  onLoadSampleData={async () => {
                    await api.loadSampleHouseholdData(selectedMonth);
                    await refreshAll();
                    notify('Loaded sample household data.');
                  }}
                  onRecordBillPaid={async (billId) => {
                    await api.recordBillPayment(billId, getTodayIso(), null);
                    await refreshAll();
                    notify('Bill payment recorded in register.');
                  }}
                  onOpenUncategorized={() => {
                    setTxAccountFilter('');
                    setTxUncategorizedOnly(true);
                    setActiveNav('transactions');
                  }}
                />
              )}

              {activeNav === 'transactions' && (
                <TransactionsView
                  accounts={summary.accounts}
                  categories={categories}
                  selectedMonth={selectedMonth}
                  initialAccountFilter={txAccountFilter}
                  initialUncategorizedOnly={txUncategorizedOnly}
                  onDataChanged={refreshAll}
                  onNotify={notify}
                />
              )}

              {activeNav === 'import' && (
                <ImportView
                  accounts={summary.accounts}
                  categories={categories}
                  onOpenAddAccount={() => {
                    setEditingAccount(null);
                    setAccountModalOpen(true);
                  }}
                  onDataChanged={refreshAll}
                  onNavigate={setActiveNav}
                  onNotify={notify}
                />
              )}

              {activeNav === 'budgets' && (
                <BudgetsView
                  selectedMonth={selectedMonth}
                  onDataChanged={refreshAll}
                  onNotify={notify}
                />
              )}

              {activeNav === 'bills' && (
                <BillsView
                  accounts={summary.accounts}
                  categories={categories}
                  onDataChanged={refreshAll}
                  onNotify={notify}
                />
              )}

              {activeNav === 'portfolio' && (
                <PortfolioView accounts={summary.accounts} onNotify={notify} />
              )}

              {activeNav === 'tax' && (
                <TaxScheduleView onNotify={notify} />
              )}

              {activeNav === 'loans' && (
                <LoanCalculatorView onNotify={notify} />
              )}

              {activeNav === 'checks' && (
                <CheckPrintingView accounts={summary.accounts} onNotify={notify} />
              )}

              {activeNav === 'reports' && <ReportsView summary={summary} />}

              {activeNav === 'rules' && (
                <RulesView
                  categories={categories}
                  onDataChanged={refreshAll}
                  onNotify={notify}
                />
              )}

              {activeNav === 'backup' && (
                <BackupView
                  selectedMonth={selectedMonth}
                  onDataChanged={refreshAll}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>

      {accountModalOpen && (
        <AccountModal
          initial={editingAccount}
          onClose={() => setAccountModalOpen(false)}
          onSave={async (input) => {
            await api.upsertAccount(input);
            await refreshAll();
            notify(editingAccount ? 'Account updated.' : 'Account created.');
          }}
          onDelete={async (accId) => {
            await api.deleteAccount(accId);
            await refreshAll();
            notify('Account deleted.');
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
