import type { AccountType, BillFrequency } from '../types';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCents(cents: number, opts?: { showPlus?: boolean; whole?: boolean }): string {
  const absVal = Math.abs(cents) / 100;
  const formatted = opts?.whole
    ? wholeCurrencyFormatter.format(absVal)
    : currencyFormatter.format(absVal);
  if (cents < 0) {
    return `-${formatted}`;
  }
  if (cents > 0 && opts?.showPlus) {
    return `+${formatted}`;
  }
  return formatted;
}

export function centsToInputString(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

export function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

export const parseCurrencyInput = parseDollarsToCents;

export function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthIso(): string {
  return getTodayIso().slice(0, 7);
}

export function shiftMonth(monthIso: string, deltaMonths: number): string {
  const [yStr, mStr] = monthIso.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return getCurrentMonthIso();
  const dt = new Date(y, m - 1 + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthHeading(monthIso: string): string {
  const [yStr, mStr] = monthIso.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthIso;
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatShortDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(dt.getTime())) return isoDate;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function accountTypeLabel(type: AccountType): string {
  switch (type) {
    case 'checking':
      return 'Checking';
    case 'savings':
      return 'Savings';
    case 'credit_card':
      return 'Credit card';
    case 'investment':
      return 'Investment';
    case 'loan':
      return 'Loan / mortgage';
    case 'cash':
      return 'Cash';
    default:
      return type;
  }
}

export function isLiabilityAccountType(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan';
}

export function frequencyLabel(freq: BillFrequency): string {
  switch (freq) {
    case 'monthly':
      return 'Monthly';
    case 'biweekly':
      return 'Every 2 weeks';
    case 'quarterly':
      return 'Quarterly';
    case 'yearly':
      return 'Yearly';
    default:
      return freq;
  }
}

export function formatDueStatus(daysUntilDue: number, active: boolean): string {
  if (!active) return 'Paused';
  if (daysUntilDue < -1) return `${Math.abs(daysUntilDue)} days past due`;
  if (daysUntilDue === -1) return '1 day past due';
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return 'Due tomorrow';
  return `Due in ${daysUntilDue} days`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'Local storage active';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
