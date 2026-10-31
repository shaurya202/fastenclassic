import {
  BarChart3,
  Calculator,
  CalendarClock,
  DatabaseBackup,
  FileSpreadsheet,
  FileUp,
  Home,
  ListFilter,
  Lock,
  Plus,
  Printer,
  ReceiptText,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { Account, NavSection } from '../types';
import { formatCents, isLiabilityAccountType } from '../lib/format';

interface SidebarProps {
  activeNav: NavSection;
  onSelectNav: (nav: NavSection) => void;
  accounts: Account[];
  uncategorizedCount: number;
  dueSoonBillsCount: number;
  onSelectAccountTransactions: (accountId: string) => void;
  onAddAccount: () => void;
  onEditAccount: (account: Account) => void;
}

export function Sidebar({
  activeNav,
  onSelectNav,
  accounts,
  uncategorizedCount,
  dueSoonBillsCount,
  onSelectAccountTransactions,
  onAddAccount,
  onEditAccount,
}: SidebarProps) {
  const assetAccounts = accounts.filter((a) => !isLiabilityAccountType(a.accountType));
  const debtAccounts = accounts.filter((a) => isLiabilityAccountType(a.accountType));

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof Home;
    badge?: number;
  }> = [
    { id: 'overview', label: 'Overview', icon: Home },
    {
      id: 'transactions',
      label: 'Transactions',
      icon: ReceiptText,
      badge: uncategorizedCount > 0 ? uncategorizedCount : undefined,
    },
    { id: 'portfolio', label: 'Investments', icon: TrendingUp },
    { id: 'import', label: 'Import statement', icon: FileUp },
    { id: 'budgets', label: 'Monthly budget', icon: Wallet },
    {
      id: 'bills',
      label: 'Bills & reminders',
      icon: CalendarClock,
      badge: dueSoonBillsCount > 0 ? dueSoonBillsCount : undefined,
    },
    { id: 'tax', label: 'Tax schedule', icon: FileSpreadsheet },
    { id: 'loans', label: 'Loan amortization', icon: Calculator },
    { id: 'checks', label: 'Check printing', icon: Printer },
    { id: 'reports', label: 'Reports & P&L', icon: BarChart3 },
    { id: 'rules', label: 'Rules & categories', icon: ListFilter },
    { id: 'backup', label: 'Backup & data', icon: DatabaseBackup },
  ];

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand-header">
        <div className="brand-mark" aria-hidden="true">
          F
        </div>
        <div>
          <div className="brand-title">Fasten Classic</div>
          <div className="brand-subtitle">Household ledger</div>
        </div>
      </div>

      <nav className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${activeNav === item.id ? 'active' : ''}`}
              onClick={() => onSelectNav(item.id)}
            >
              <span className="nav-btn-left">
                <Icon size={17} strokeWidth={1.9} />
                <span>{item.label}</span>
              </span>
              {item.badge !== undefined && <span className="nav-badge">{item.badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-accounts">
        <div className="sidebar-section-header">
          <span className="sidebar-section-title">Accounts</span>
          <button
            type="button"
            className="icon-btn"
            title="Add account"
            aria-label="Add account"
            onClick={onAddAccount}
          >
            <Plus size={16} />
          </button>
        </div>

        {accounts.length === 0 ? (
          <div style={{ padding: '6px 8px', fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
            No accounts yet. Add checking, savings, or credit card accounts to begin.
          </div>
        ) : (
          <>
            {assetAccounts.length > 0 && (
              <div>
                <div className="sidebar-group-label">Cash & investments</div>
                {assetAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    className="account-pill"
                    onClick={() => onSelectAccountTransactions(acc.id)}
                    onDoubleClick={() => onEditAccount(acc)}
                    title={`${acc.name} (${acc.institution || 'Local account'}) — double-click to edit`}
                  >
                    <span className="account-pill-name">{acc.name}</span>
                    <span
                      className={`account-pill-bal ${acc.currentBalanceCents < 0 ? 'amt-negative' : ''}`}
                    >
                      {formatCents(acc.currentBalanceCents)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {debtAccounts.length > 0 && (
              <div>
                <div className="sidebar-group-label">Credit cards & loans</div>
                {debtAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    className="account-pill"
                    onClick={() => onSelectAccountTransactions(acc.id)}
                    onDoubleClick={() => onEditAccount(acc)}
                    title={`${acc.name} (${acc.institution || 'Local account'}) — double-click to edit`}
                  >
                    <span className="account-pill-name">{acc.name}</span>
                    <span
                      className={`account-pill-bal ${acc.currentBalanceCents < 0 ? 'amt-negative' : ''}`}
                    >
                      {formatCents(acc.currentBalanceCents)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <Lock size={13} />
        <span>Stored locally on this computer</span>
      </div>
    </aside>
  );
}
