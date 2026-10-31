import type {
  Account,
  AmortizationMonth,
  BudgetRow,
  Category,
  CategoryRule,
  CategorySpendingPoint,
  CommitImportRequest,
  CommitImportResult,
  CurrencyRate,
  CsvColumnMapping,
  DashboardSummary,
  HoldingSummary,
  ImportPreviewRequest,
  ImportPreviewResponse,
  ImportPreviewRow,
  IncomeExpenseReport,
  InvestmentTransaction,
  LoanCalculation,
  LoanPayoffComparison,
  MonthBudgetSummary,
  MonthlyTrendPoint,
  PayeeSpendingPoint,
  PortfolioSummary,
  RecurringBill,
  Security,
  StorageInfo,
  TaxScheduleItem,
  TaxYearReport,
  Transaction,
  TransactionFilter,
  UpsertAccountInput,
  UpsertCategoryInput,
  UpsertCategoryRuleInput,
  UpsertCurrencyRateInput,
  RecordInvestmentTxInput,
  UpsertRecurringBillInput,
  UpsertTransactionInput,
} from '../types';
import { shiftMonth } from './format';

const STORAGE_KEY = 'fasten_classic_local_store_v1';

interface RawAccount {
  id: string;
  name: string;
  accountType: Account['accountType'];
  institution: string;
  openingBalanceCents: number;
  openingDate: string;
  notes: string;
  createdAt: string;
}

interface RawRule {
  id: string;
  pattern: string;
  matchType: CategoryRule['matchType'];
  categoryId: string;
  renamePayee?: string | null;
  accountId?: string | null;
  priority: number;
}

interface RawTx {
  id: string;
  accountId: string;
  postedDate: string;
  payee: string;
  originalPayee: string;
  memo: string;
  amountCents: number;
  categoryId?: string | null;
  externalId?: string | null;
  fingerprint: string;
  cleared: boolean;
  importSource?: string | null;
  createdAt: string;
}

interface RawBudget {
  id: string;
  month: string;
  categoryId: string;
  limitCents: number;
}

interface RawBill {
  id: string;
  name: string;
  payee: string;
  amountCents: number;
  categoryId?: string | null;
  accountId?: string | null;
  frequency: RecurringBill['frequency'];
  nextDueDate: string;
  autoPay: boolean;
  notes: string;
  active: boolean;
}

interface StoreState {
  accounts: RawAccount[];
  categories: Category[];
  categoryRules: RawRule[];
  transactions: RawTx[];
  budgets: RawBudget[];
  recurringBills: RawBill[];
}

function defaultCategories(): Category[] {
  return [
    { id: 'cat-income-paycheck', name: 'Paycheck & Salary', groupName: 'Income', kind: 'income', color: '#1B5E4A' },
    { id: 'cat-income-other', name: 'Other Income', groupName: 'Income', kind: 'income', color: '#2D7A62' },
    { id: 'cat-housing', name: 'Housing & Mortgage', groupName: 'Essential Living', kind: 'expense', color: '#294C66' },
    { id: 'cat-groceries', name: 'Groceries', groupName: 'Essential Living', kind: 'expense', color: '#2E6F57' },
    { id: 'cat-utilities', name: 'Utilities & Internet', groupName: 'Essential Living', kind: 'expense', color: '#3D6582' },
    { id: 'cat-transport', name: 'Transportation & Fuel', groupName: 'Essential Living', kind: 'expense', color: '#7A5C2E' },
    { id: 'cat-healthcare', name: 'Healthcare & Pharmacy', groupName: 'Essential Living', kind: 'expense', color: '#8E4A49' },
    { id: 'cat-insurance', name: 'Insurance', groupName: 'Essential Living', kind: 'expense', color: '#5A5475' },
    { id: 'cat-dining', name: 'Dining & Coffee', groupName: 'Lifestyle', kind: 'expense', color: '#A6631B' },
    { id: 'cat-household', name: 'Household & Shopping', groupName: 'Lifestyle', kind: 'expense', color: '#4A6670' },
    { id: 'cat-subscriptions', name: 'Subscriptions & Media', groupName: 'Lifestyle', kind: 'expense', color: '#6B5B8E' },
    { id: 'cat-family', name: 'Family & Recreation', groupName: 'Lifestyle', kind: 'expense', color: '#3A746B' },
    { id: 'cat-transfer', name: 'Transfer / Card Payment', groupName: 'Transfers', kind: 'transfer', color: '#64748B' },
  ];
}

function defaultRules(): RawRule[] {
  return [
    { id: 'rule-payroll', pattern: 'PAYROLL', matchType: 'contains', categoryId: 'cat-income-paycheck', renamePayee: 'Employer Payroll', priority: 200 },
    { id: 'rule-direct-dep', pattern: 'DIRECT DEP', matchType: 'contains', categoryId: 'cat-income-paycheck', renamePayee: null, priority: 195 },
    { id: 'rule-trader-joes', pattern: 'TRADER JOE', matchType: 'contains', categoryId: 'cat-groceries', renamePayee: "Trader Joe's", priority: 150 },
    { id: 'rule-whole-foods', pattern: 'WHOLEFDS', matchType: 'contains', categoryId: 'cat-groceries', renamePayee: 'Whole Foods Market', priority: 150 },
    { id: 'rule-whole-foods-2', pattern: 'WHOLE FOODS', matchType: 'contains', categoryId: 'cat-groceries', renamePayee: 'Whole Foods Market', priority: 150 },
    { id: 'rule-kroger', pattern: 'KROGER', matchType: 'contains', categoryId: 'cat-groceries', renamePayee: 'Kroger', priority: 145 },
    { id: 'rule-costco', pattern: 'COSTCO WHSE', matchType: 'contains', categoryId: 'cat-groceries', renamePayee: 'Costco', priority: 145 },
    { id: 'rule-mortgage', pattern: 'MORTGAGE', matchType: 'contains', categoryId: 'cat-housing', renamePayee: null, priority: 160 },
    { id: 'rule-electric', pattern: 'ELECTRIC', matchType: 'contains', categoryId: 'cat-utilities', renamePayee: null, priority: 140 },
    { id: 'rule-comcast', pattern: 'XFINITY', matchType: 'contains', categoryId: 'cat-utilities', renamePayee: 'Xfinity Internet', priority: 140 },
    { id: 'rule-shell', pattern: 'SHELL OIL', matchType: 'contains', categoryId: 'cat-transport', renamePayee: 'Shell', priority: 135 },
    { id: 'rule-chevron', pattern: 'CHEVRON', matchType: 'contains', categoryId: 'cat-transport', renamePayee: 'Chevron', priority: 135 },
    { id: 'rule-cvs', pattern: 'CVS/PHARMACY', matchType: 'contains', categoryId: 'cat-healthcare', renamePayee: 'CVS Pharmacy', priority: 135 },
    { id: 'rule-netflix', pattern: 'NETFLIX', matchType: 'contains', categoryId: 'cat-subscriptions', renamePayee: 'Netflix', priority: 130 },
    { id: 'rule-spotify', pattern: 'SPOTIFY', matchType: 'contains', categoryId: 'cat-subscriptions', renamePayee: 'Spotify', priority: 130 },
    { id: 'rule-coffee', pattern: 'BLUE BOTTLE', matchType: 'contains', categoryId: 'cat-dining', renamePayee: 'Blue Bottle Coffee', priority: 125 },
    { id: 'rule-starbucks', pattern: 'STARBUCKS', matchType: 'contains', categoryId: 'cat-dining', renamePayee: 'Starbucks', priority: 125 },
    { id: 'rule-amazon', pattern: 'AMZN MKTP', matchType: 'contains', categoryId: 'cat-household', renamePayee: 'Amazon', priority: 120 },
    { id: 'rule-cc-payment', pattern: 'CREDIT CARD PMT', matchType: 'contains', categoryId: 'cat-transfer', renamePayee: null, priority: 180 },
    { id: 'rule-autopay-card', pattern: 'CARD AUTOPAY', matchType: 'contains', categoryId: 'cat-transfer', renamePayee: null, priority: 180 },
  ];
}

function emptyStore(): StoreState {
  return {
    accounts: [],
    categories: defaultCategories(),
    categoryRules: defaultRules(),
    transactions: [],
    budgets: [],
    recurringBills: [],
  };
}

function loadStore(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = emptyStore();
      saveStore(initial);
      return initial;
    }
    return JSON.parse(raw) as StoreState;
  } catch {
    const initial = emptyStore();
    saveStore(initial);
    return initial;
  }
}

function saveStore(state: StoreState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function normalizePayeeKey(payee: string): string {
  return payee
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function simpleHash(str: string): string {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function baseSignature(accountId: string, postedDate: string, amountCents: number, payee: string): string {
  return simpleHash(`${accountId}|${postedDate.trim()}|${amountCents}|${normalizePayeeKey(payee)}`);
}

export function parseFlexibleDateJs(raw: string): string {
  const trimmed = raw.trim().replace(/^"|"$/g, '').trim();
  if (!trimmed) throw new Error('Date value is blank.');

  if (trimmed.includes("'")) {
    const [md, yr] = trimmed.split("'");
    return parseFlexibleDateJs(`${md.trim()}/${yr.trim().replace(/\s+/g, '0')}`);
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  if (/^\d{8}/.test(trimmed) && !trimmed.includes('/') && !trimmed.includes('-')) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }

  const sep = trimmed.includes('/') ? '/' : trimmed.includes('-') ? '-' : trimmed.includes('.') ? '.' : null;
  if (sep) {
    const parts = trimmed.split(sep).map((s) => s.trim());
    if (parts.length === 3) {
      const p0 = Number(parts[0]);
      const p1 = Number(parts[1]);
      const p2 = Number(parts[2]);
      if (Number.isFinite(p0) && Number.isFinite(p1) && Number.isFinite(p2)) {
        if (parts[0].length === 4) {
          return `${String(p0).padStart(4, '0')}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
        }
        const year = p2 < 100 ? (p2 >= 70 ? 1900 + p2 : 2000 + p2) : p2;
        const [month, day] = p0 > 12 && p1 <= 12 ? [p1, p0] : [p0, p1];
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  throw new Error(`Could not understand date '${trimmed}'. Expected a format like 2026-10-31 or 10/31/2026.`);
}

export function parseAmountToCentsJs(raw: string): number {
  let s = raw.trim().replace(/^"|"$/g, '').trim();
  if (!s) throw new Error('Amount is blank.');
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (/dr$/i.test(s)) {
    neg = true;
    s = s.slice(0, -2).trim();
  } else if (/cr$/i.test(s)) {
    s = s.slice(0, -2).trim();
  }
  s = s.replace(/[$€£¥\s\u00a0]/g, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot && lastDot !== -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1 && lastDot !== -1) {
    s = s.replace(/,/g, '');
  } else if (lastComma !== -1 && lastDot === -1) {
    if (s.length - lastComma - 1 === 2 && s.indexOf(',') === lastComma) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  }
  const val = Number(s);
  if (!Number.isFinite(val)) throw new Error(`Could not read amount '${raw}'.`);
  const cents = Math.round(Math.abs(val) * 100);
  return neg ? -cents : cents;
}

function splitCsvRecords(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field.trim());
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

function matchRule(rules: RawRule[], payee: string, memo: string, accountId: string): RawRule | null {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  const pLow = payee.trim().toLowerCase();
  const cLow = memo.trim() ? `${pLow} ${memo.trim().toLowerCase()}` : pLow;
  for (const r of sorted) {
    if (r.accountId && r.accountId !== accountId) continue;
    const pat = r.pattern.trim().toLowerCase();
    if (!pat) continue;
    const ok =
      r.matchType === 'exact'
        ? pLow === pat || cLow === pat
        : r.matchType === 'starts_with'
          ? pLow.startsWith(pat) || cLow.startsWith(pat)
          : cLow.includes(pat);
    if (ok) return r;
  }
  return null;
}

export const localFallbackApi = {
  async listAccounts(): Promise<Account[]> {
    const s = loadStore();
    return s.accounts.map((a) => {
      const txs = s.transactions.filter((t) => t.accountId === a.id);
      const sum = txs.reduce((acc, t) => acc + t.amountCents, 0);
      return {
        ...a,
        currentBalanceCents: a.openingBalanceCents + sum,
        transactionCount: txs.length,
      };
    });
  },

  async upsertAccount(input: UpsertAccountInput): Promise<Account> {
    if (!input.name.trim()) throw new Error("Enter an account name (for example, 'Family Checking').");
    const s = loadStore();
    const id = input.id?.trim() || makeId('acc');
    const existingIdx = s.accounts.findIndex((a) => a.id === id);
    const record: RawAccount = {
      id,
      name: input.name.trim(),
      accountType: input.accountType,
      institution: input.institution.trim(),
      openingBalanceCents: input.openingBalanceCents,
      openingDate: input.openingDate.trim() || '2026-01-01',
      notes: (input.notes ?? '').trim(),
      createdAt: existingIdx >= 0 ? s.accounts[existingIdx].createdAt : new Date().toISOString(),
    };
    if (existingIdx >= 0) s.accounts[existingIdx] = record;
    else s.accounts.push(record);
    saveStore(s);
    const all = await this.listAccounts();
    return all.find((a) => a.id === id)!;
  },

  async deleteAccount(accountId: string): Promise<void> {
    const s = loadStore();
    s.accounts = s.accounts.filter((a) => a.id !== accountId);
    s.transactions = s.transactions.filter((t) => t.accountId !== accountId);
    saveStore(s);
  },

  async listCategories(): Promise<Category[]> {
    return loadStore().categories;
  },

  async upsertCategory(input: UpsertCategoryInput): Promise<Category> {
    if (!input.name.trim()) throw new Error('Category name cannot be blank.');
    const s = loadStore();
    const id = input.id?.trim() || makeId('cat');
    const cat: Category = {
      id,
      name: input.name.trim(),
      groupName: input.groupName.trim(),
      kind: input.kind,
      color: input.color.trim(),
    };
    const idx = s.categories.findIndex((c) => c.id === id);
    if (idx >= 0) s.categories[idx] = cat;
    else s.categories.push(cat);
    saveStore(s);
    return cat;
  },

  async deleteCategory(categoryId: string): Promise<void> {
    const s = loadStore();
    s.categories = s.categories.filter((c) => c.id !== categoryId);
    s.categoryRules = s.categoryRules.filter((r) => r.categoryId !== categoryId);
    s.transactions = s.transactions.map((t) =>
      t.categoryId === categoryId ? { ...t, categoryId: null } : t
    );
    saveStore(s);
  },

  async listCategoryRules(): Promise<CategoryRule[]> {
    const s = loadStore();
    const catMap = new Map(s.categories.map((c) => [c.id, c.name]));
    return [...s.categoryRules]
      .sort((a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern))
      .map((r) => ({
        ...r,
        categoryName: catMap.get(r.categoryId) ?? null,
      }));
  },

  async upsertCategoryRule(input: UpsertCategoryRuleInput): Promise<CategoryRule> {
    if (!input.pattern.trim()) throw new Error('Rule match text cannot be blank.');
    const s = loadStore();
    const id = input.id?.trim() || makeId('rule');
    const rec: RawRule = {
      id,
      pattern: input.pattern.trim(),
      matchType: input.matchType,
      categoryId: input.categoryId,
      renamePayee: input.renamePayee?.trim() || null,
      accountId: input.accountId?.trim() || null,
      priority: input.priority,
    };
    const idx = s.categoryRules.findIndex((r) => r.id === id);
    if (idx >= 0) s.categoryRules[idx] = rec;
    else s.categoryRules.push(rec);
    saveStore(s);
    const rules = await this.listCategoryRules();
    return rules.find((r) => r.id === id)!;
  },

  async deleteCategoryRule(ruleId: string): Promise<void> {
    const s = loadStore();
    s.categoryRules = s.categoryRules.filter((r) => r.id !== ruleId);
    saveStore(s);
  },

  async applyCategoryRules(onlyUncategorized: boolean): Promise<number> {
    const s = loadStore();
    let updated = 0;
    s.transactions = s.transactions.map((tx) => {
      if (onlyUncategorized && tx.categoryId) return tx;
      const m =
        matchRule(s.categoryRules, tx.originalPayee || tx.payee, tx.memo, tx.accountId) ||
        matchRule(s.categoryRules, tx.payee, tx.memo, tx.accountId);
      if (!m) return tx;
      updated++;
      return {
        ...tx,
        categoryId: m.categoryId,
        payee: m.renamePayee || tx.payee,
      };
    });
    saveStore(s);
    return updated;
  },

  async listTransactions(filter: TransactionFilter): Promise<Transaction[]> {
    const s = loadStore();
    const accMap = new Map(s.accounts.map((a) => [a.id, a.name]));
    const catMap = new Map(s.categories.map((c) => [c.id, c]));
    const q = filter.search?.trim().toLowerCase();

    return [...s.transactions]
      .sort((a, b) => b.postedDate.localeCompare(a.postedDate) || b.createdAt.localeCompare(a.createdAt))
      .map((t) => {
        const cat = t.categoryId ? catMap.get(t.categoryId) : undefined;
        return {
          ...t,
          accountName: accMap.get(t.accountId) ?? null,
          categoryName: cat?.name ?? null,
          categoryKind: cat?.kind ?? null,
          categoryColor: cat?.color ?? null,
        };
      })
      .filter((tx) => {
        if (filter.accountId && tx.accountId !== filter.accountId) return false;
        if (filter.categoryId && tx.categoryId !== filter.categoryId) return false;
        if (filter.uncategorizedOnly && tx.categoryId) return false;
        if (filter.month && !tx.postedDate.startsWith(filter.month)) return false;
        if (q) {
          const hay = `${tx.payee} ${tx.originalPayee} ${tx.memo} ${tx.categoryName ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  },

  async upsertTransaction(input: UpsertTransactionInput): Promise<Transaction> {
    if (!input.payee.trim()) throw new Error('Enter a payee or description for this transaction.');
    const postedDate = parseFlexibleDateJs(input.postedDate);
    const s = loadStore();
    const id = input.id?.trim() || makeId('tx');
    const idx = s.transactions.findIndex((t) => t.id === id);

    if (idx >= 0) {
      s.transactions[idx] = {
        ...s.transactions[idx],
        accountId: input.accountId,
        postedDate,
        payee: input.payee.trim(),
        memo: (input.memo ?? '').trim(),
        amountCents: input.amountCents,
        categoryId: input.categoryId || null,
        cleared: input.cleared ?? true,
      };
    } else {
      const base = baseSignature(input.accountId, postedDate, input.amountCents, input.payee);
      const count = s.transactions.filter(
        (t) => t.accountId === input.accountId && t.fingerprint.startsWith(`${base}#`)
      ).length;
      s.transactions.push({
        id,
        accountId: input.accountId,
        postedDate,
        payee: input.payee.trim(),
        originalPayee: input.payee.trim(),
        memo: (input.memo ?? '').trim(),
        amountCents: input.amountCents,
        categoryId: input.categoryId || null,
        externalId: null,
        fingerprint: `${base}#${count + 1}`,
        cleared: input.cleared ?? true,
        importSource: 'manual',
        createdAt: new Date().toISOString(),
      });
    }
    saveStore(s);
    const all = await this.listTransactions({});
    return all.find((t) => t.id === id)!;
  },

  async assignTransactionCategory(
    transactionId: string,
    categoryId: string | null,
    createRulePattern?: string | null
  ): Promise<number> {
    const s = loadStore();
    const idx = s.transactions.findIndex((t) => t.id === transactionId);
    if (idx >= 0) {
      s.transactions[idx].categoryId = categoryId || null;
      saveStore(s);
    }
    if (categoryId && createRulePattern?.trim()) {
      await this.upsertCategoryRule({
        pattern: createRulePattern.trim(),
        matchType: 'contains',
        categoryId,
        priority: 170,
      });
      return this.applyCategoryRules(true);
    }
    return 0;
  },

  async deleteTransaction(transactionId: string): Promise<void> {
    const s = loadStore();
    s.transactions = s.transactions.filter((t) => t.id !== transactionId);
    saveStore(s);
  },

  async previewStatementImport(req: ImportPreviewRequest): Promise<ImportPreviewResponse> {
    if (!req.accountId) throw new Error('Select an account to import this statement into.');
    const content = req.content.replace(/^\uFEFF/, '');
    if (!content.trim()) throw new Error('The selected statement file is empty.');

    const lowerName = req.fileName.toLowerCase();
    const format =
      req.formatOverride ||
      (lowerName.endsWith('.ofx') || lowerName.endsWith('.qfx') || /<STMTTRN>|OFXHEADER:/i.test(content)
        ? 'ofx'
        : lowerName.endsWith('.qif') || /^!(Type|Account|Option):/im.test(content.trim())
          ? 'qif'
          : 'csv');

    interface TempRow {
      postedDate: string;
      payee: string;
      memo: string;
      amountCents: number;
      externalId?: string | null;
      categoryHint?: string | null;
    }

    const parsedRows: TempRow[] = [];
    const warnings: string[] = [];
    let statementBalanceCents: number | null = null;
    let csvHeaders: string[] | null = null;
    let inferredCsvMapping: CsvColumnMapping | null = null;

    if (format === 'ofx') {
      const balMatch = content.match(/<BALAMT>([^<\r\n]+)/i);
      if (balMatch) {
        try {
          statementBalanceCents = parseAmountToCentsJs(balMatch[1]);
        } catch {
          statementBalanceCents = null;
        }
      }
      const blocks = content.split(/<STMTTRN>/i).slice(1);
      for (const rawBlock of blocks) {
        const block = rawBlock.split(/<\/STMTTRN>/i)[0];
        const tag = (name: string) => {
          const m = block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, 'i'));
          return m
            ? m[1]
                .replace(/&amp;/g, '&')
                .replace(/&apos;/g, "'")
                .replace(/&quot;/g, '"')
                .trim()
            : null;
        };
        const dt = tag('DTPOSTED') || tag('DTUSER');
        const amt = tag('TRNAMT');
        if (!dt || !amt) continue;
        const digits = dt.match(/^\d{8}/)?.[0] ?? dt;
        parsedRows.push({
          postedDate: parseFlexibleDateJs(digits),
          payee: tag('NAME') || tag('PAYEE') || 'Bank transaction',
          memo: tag('MEMO') || '',
          amountCents: parseAmountToCentsJs(amt),
          externalId: tag('FITID'),
        });
      }
      if (!parsedRows.length) throw new Error('No <STMTTRN> transactions were found in this OFX/QFX statement.');
    } else if (format === 'qif') {
      let dt: string | null = null;
      let amt: string | null = null;
      let payee: string | null = null;
      let memo: string | null = null;
      let cat: string | null = null;
      let num: string | null = null;
      const flush = () => {
        if (!dt && !amt) return;
        if (!dt || !amt) {
          dt = amt = payee = memo = cat = num = null;
          return;
        }
        const mParts = [num ? `Ref #${num}` : '', memo || ''].filter(Boolean);
        parsedRows.push({
          postedDate: parseFlexibleDateJs(dt),
          payee: payee || memo || (num ? `Check #${num}` : 'QIF transaction'),
          memo: mParts.join(' - '),
          amountCents: parseAmountToCentsJs(amt),
          categoryHint: cat,
        });
        dt = amt = payee = memo = cat = num = null;
      };
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('!')) continue;
        if (line === '^') {
          flush();
          continue;
        }
        const code = line[0].toUpperCase();
        const val = line.slice(1).trim();
        if (code === 'D') dt = val;
        else if (code === 'T' || code === 'U') amt = val;
        else if (code === 'P') payee = val;
        else if (code === 'M') memo = val;
        else if (code === 'L') cat = val;
        else if (code === 'N') num = val;
      }
      flush();
      if (!parsedRows.length) throw new Error('No valid QIF transactions were found.');
    } else {
      const delim = content.split(/\r?\n/)[0]?.includes(';') ? ';' : content.includes('\t') ? '\t' : ',';
      const rows = splitCsvRecords(content, delim);
      if (rows.length < 2) throw new Error('CSV statement must include a header row and at least one transaction row.');
      let headerIdx = 0;
      let best = 0;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const sc = rows[i].filter((c) => /date|desc|payee|amount|debit|credit|memo/i.test(c)).length;
        if (sc > best) {
          best = sc;
          headerIdx = i;
        }
      }
      csvHeaders = rows[headerIdx];
      const autoMap: CsvColumnMapping = {};
      csvHeaders.forEach((h, idx) => {
        const low = h.toLowerCase();
        if (autoMap.dateCol == null && low.includes('date')) autoMap.dateCol = idx;
        else if (autoMap.payeeCol == null && /payee|description|merchant|name/.test(low)) autoMap.payeeCol = idx;
        else if (autoMap.memoCol == null && /memo|note|detail/.test(low)) autoMap.memoCol = idx;
        else if (autoMap.amountCol == null && (low === 'amount' || low.includes('amount'))) autoMap.amountCol = idx;
        else if (autoMap.debitCol == null && /debit|withdrawal|outflow/.test(low)) autoMap.debitCol = idx;
        else if (autoMap.creditCol == null && /credit|deposit|inflow/.test(low)) autoMap.creditCol = idx;
      });
      const eff: CsvColumnMapping = { ...autoMap, ...(req.csvMapping ?? {}) };
      inferredCsvMapping = eff;
      if (eff.dateCol == null || eff.payeeCol == null) {
        throw new Error('Could not identify Date or Description columns. Adjust the CSV column mapping.');
      }
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const cells = rows[r];
        const dateRaw = cells[eff.dateCol] ?? '';
        if (!dateRaw.trim()) continue;
        const postedDate = parseFlexibleDateJs(dateRaw);
        const payee = (cells[eff.payeeCol] ?? '').trim() || 'Unspecified payee';
        const memo = eff.memoCol != null ? (cells[eff.memoCol] ?? '').trim() : '';
        let cents = 0;
        if (eff.debitCol != null && eff.creditCol != null) {
          const d = (cells[eff.debitCol] ?? '').trim();
          const c = (cells[eff.creditCol] ?? '').trim();
          const dVal = d ? Math.abs(parseAmountToCentsJs(d)) : 0;
          const cVal = c ? Math.abs(parseAmountToCentsJs(c)) : 0;
          cents = cVal - dVal;
        } else if (eff.amountCol != null) {
          cents = parseAmountToCentsJs(cells[eff.amountCol] ?? '0');
        }
        if (eff.invertAmount) cents = -cents;
        parsedRows.push({ postedDate, payee, memo, amountCents: cents });
      }
    }

    const s = loadStore();
    const catMap = new Map(s.categories.map((c) => [c.id, c.name]));
    const existingExt = new Set(
      s.transactions.filter((t) => t.accountId === req.accountId && t.externalId).map((t) => t.externalId!)
    );
    const existingFp = new Set(
      s.transactions.filter((t) => t.accountId === req.accountId).map((t) => t.fingerprint)
    );
    const occCounter = new Map<string, number>();
    const seenExt = new Set<string>();
    let duplicateRows = 0;

    const previewRows: ImportPreviewRow[] = parsedRows.map((r, idx) => {
      const base = baseSignature(req.accountId, r.postedDate, r.amountCents, r.payee);
      const occ = (occCounter.get(base) ?? 0) + 1;
      occCounter.set(base, occ);
      const fingerprint = `${base}#${occ}`;

      let isDuplicate = false;
      let duplicateReason: string | null = null;
      if (r.externalId) {
        if (existingExt.has(r.externalId)) {
          isDuplicate = true;
          duplicateReason = `Already imported (bank ID ${r.externalId})`;
        } else if (seenExt.has(r.externalId)) {
          isDuplicate = true;
          duplicateReason = `Duplicate bank ID ${r.externalId} within statement`;
        }
        seenExt.add(r.externalId);
      }
      if (!isDuplicate && existingFp.has(fingerprint)) {
        isDuplicate = true;
        duplicateReason = `Matches existing transaction on ${r.postedDate}`;
      }
      if (isDuplicate) duplicateRows++;

      const m = matchRule(s.categoryRules, r.payee, r.memo, req.accountId);
      let categoryId: string | null = m ? m.categoryId : null;
      if (!categoryId && r.categoryHint) {
        const hintLow = r.categoryHint.toLowerCase();
        const found = s.categories.find((c) => c.name.toLowerCase().includes(hintLow) || hintLow.includes(c.name.toLowerCase()));
        if (found) categoryId = found.id;
      }

      return {
        rowIndex: idx,
        postedDate: r.postedDate,
        payee: m?.renamePayee || r.payee,
        originalPayee: r.payee,
        memo: r.memo,
        amountCents: r.amountCents,
        categoryId,
        categoryName: categoryId ? catMap.get(categoryId) ?? null : null,
        matchedRuleId: m?.id ?? null,
        externalId: r.externalId ?? null,
        fingerprint,
        isDuplicate,
        duplicateReason,
        selected: !isDuplicate,
      };
    });

    return {
      detectedFormat: format,
      totalRows: previewRows.length,
      newRows: previewRows.length - duplicateRows,
      duplicateRows,
      statementBalanceCents,
      csvHeaders,
      inferredCsvMapping,
      warnings,
      rows: previewRows,
    };
  },

  async commitStatementImport(req: CommitImportRequest): Promise<CommitImportResult> {
    const s = loadStore();
    let importedCount = 0;
    let skippedCount = 0;
    const now = new Date().toISOString();

    for (const r of req.rows) {
      const dupExt =
        r.externalId &&
        s.transactions.some((t) => t.accountId === req.accountId && t.externalId === r.externalId);
      const dupFp = s.transactions.some(
        (t) => t.accountId === req.accountId && t.fingerprint === r.fingerprint
      );
      if (dupExt || dupFp) {
        skippedCount++;
        continue;
      }
      s.transactions.push({
        id: makeId('tx'),
        accountId: req.accountId,
        postedDate: r.postedDate,
        payee: r.payee.trim(),
        originalPayee: r.originalPayee.trim(),
        memo: r.memo.trim(),
        amountCents: r.amountCents,
        categoryId: r.categoryId || null,
        externalId: r.externalId || null,
        fingerprint: r.fingerprint,
        cleared: true,
        importSource: req.sourceName,
        createdAt: now,
      });
      importedCount++;
    }
    saveStore(s);
    return { importedCount, skippedCount };
  },

  async getMonthBudget(month: string): Promise<MonthBudgetSummary> {
    const s = loadStore();
    const bMap = new Map(
      s.budgets.filter((b) => b.month === month).map((b) => [b.categoryId, b.limitCents])
    );
    const catKindMap = new Map(s.categories.map((c) => [c.id, c.kind]));
    const netByCat = new Map<string, number>();
    let incomeCents = 0;

    for (const tx of s.transactions) {
      if (!tx.postedDate.startsWith(month)) continue;
      const kind = tx.categoryId ? catKindMap.get(tx.categoryId) ?? 'expense' : 'expense';
      if (kind === 'transfer') continue;
      if (kind === 'income' || (!tx.categoryId && tx.amountCents > 0)) {
        incomeCents += tx.amountCents;
      }
      if (tx.categoryId) {
        netByCat.set(tx.categoryId, (netByCat.get(tx.categoryId) ?? 0) + tx.amountCents);
      }
    }

    let totalBudgetedCents = 0;
    let totalSpentCents = 0;
    const rows: BudgetRow[] = s.categories
      .filter((c) => c.kind === 'expense')
      .map((cat) => {
        const budgeted = bMap.get(cat.id) ?? 0;
        const net = netByCat.get(cat.id) ?? 0;
        const spent = Math.max(0, -net);
        totalBudgetedCents += budgeted;
        totalSpentCents += spent;
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          groupName: cat.groupName,
          color: cat.color,
          month,
          budgetedCents: budgeted,
          spentCents: spent,
          remainingCents: budgeted - spent,
        };
      });

    return {
      month,
      totalBudgetedCents,
      totalSpentCents,
      totalRemainingCents: totalBudgetedCents - totalSpentCents,
      incomeCents,
      rows,
    };
  },

  async setCategoryBudget(month: string, categoryId: string, limitCents: number): Promise<void> {
    const s = loadStore();
    s.budgets = s.budgets.filter((b) => !(b.month === month && b.categoryId === categoryId));
    if (limitCents > 0) {
      s.budgets.push({ id: `bgt-${month}-${categoryId}`, month, categoryId, limitCents });
    }
    saveStore(s);
  },

  async copyPreviousMonthBudget(targetMonth: string): Promise<number> {
    const prev = shiftMonth(targetMonth, -1);
    const s = loadStore();
    const prevItems = s.budgets.filter((b) => b.month === prev);
    for (const item of prevItems) {
      s.budgets = s.budgets.filter(
        (b) => !(b.month === targetMonth && b.categoryId === item.categoryId)
      );
      s.budgets.push({
        id: `bgt-${targetMonth}-${item.categoryId}`,
        month: targetMonth,
        categoryId: item.categoryId,
        limitCents: item.limitCents,
      });
    }
    saveStore(s);
    return prevItems.length;
  },

  async listRecurringBills(referenceDate: string): Promise<RecurringBill[]> {
    const s = loadStore();
    const catMap = new Map(s.categories.map((c) => [c.id, c.name]));
    const accMap = new Map(s.accounts.map((a) => [a.id, a.name]));
    const refMs = new Date(`${referenceDate}T00:00:00`).getTime();

    return [...s.recurringBills]
      .map((b) => {
        const dueMs = new Date(`${b.nextDueDate}T00:00:00`).getTime();
        const daysUntilDue = Math.round((dueMs - refMs) / 86_400_000);
        const status: RecurringBill['status'] = !b.active
          ? 'paused'
          : daysUntilDue < 0
            ? 'overdue'
            : daysUntilDue <= 7
              ? 'due_soon'
              : 'upcoming';
        return {
          ...b,
          categoryName: b.categoryId ? catMap.get(b.categoryId) ?? null : null,
          accountName: b.accountId ? accMap.get(b.accountId) ?? null : null,
          daysUntilDue,
          status,
        };
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || a.nextDueDate.localeCompare(b.nextDueDate));
  },

  async upsertRecurringBill(input: UpsertRecurringBillInput, referenceDate: string): Promise<RecurringBill> {
    if (!input.name.trim()) throw new Error("Enter a bill name (for example, 'Electric Bill').");
    const s = loadStore();
    const id = input.id?.trim() || makeId('bill');
    const rec: RawBill = {
      id,
      name: input.name.trim(),
      payee: input.payee.trim() || input.name.trim(),
      amountCents: Math.abs(input.amountCents),
      categoryId: input.categoryId || null,
      accountId: input.accountId || null,
      frequency: input.frequency,
      nextDueDate: parseFlexibleDateJs(input.nextDueDate),
      autoPay: input.autoPay,
      notes: (input.notes ?? '').trim(),
      active: input.active ?? true,
    };
    const idx = s.recurringBills.findIndex((b) => b.id === id);
    if (idx >= 0) s.recurringBills[idx] = rec;
    else s.recurringBills.push(rec);
    saveStore(s);
    const all = await this.listRecurringBills(referenceDate);
    return all.find((b) => b.id === id)!;
  },

  async deleteRecurringBill(billId: string): Promise<void> {
    const s = loadStore();
    s.recurringBills = s.recurringBills.filter((b) => b.id !== billId);
    saveStore(s);
  },

  async recordBillPayment(billId: string, paidDate: string, accountIdOverride?: string | null): Promise<Transaction> {
    const s = loadStore();
    const bill = s.recurringBills.find((b) => b.id === billId);
    if (!bill) throw new Error('Could not find that recurring bill.');
    const targetAcc = accountIdOverride || bill.accountId || s.accounts[0]?.id;
    if (!targetAcc) throw new Error('Create at least one account before recording a bill payment.');

    const tx = await this.upsertTransaction({
      accountId: targetAcc,
      postedDate: paidDate,
      payee: bill.payee,
      memo: `Recurring bill: ${bill.name}`,
      amountCents: -Math.abs(bill.amountCents),
      categoryId: bill.categoryId,
      cleared: true,
    });

    const latest = loadStore();
    const targetBill = latest.recurringBills.find((b) => b.id === billId);
    if (targetBill) {
      const [y, m, d] = targetBill.nextDueDate.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      if (targetBill.frequency === 'biweekly') dt.setDate(dt.getDate() + 14);
      else if (targetBill.frequency === 'quarterly') dt.setMonth(dt.getMonth() + 3);
      else if (targetBill.frequency === 'yearly') dt.setFullYear(dt.getFullYear() + 1);
      else dt.setMonth(dt.getMonth() + 1);
      targetBill.nextDueDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      saveStore(latest);
    }

    return tx;
  },

  async getDashboardSummary(month: string, referenceDate: string): Promise<DashboardSummary> {
    const accounts = await this.listAccounts();
    let assetsCents = 0;
    let liabilitiesCents = 0;
    let netWorthCents = 0;
    for (const a of accounts) {
      netWorthCents += a.currentBalanceCents;
      if (a.currentBalanceCents >= 0) assetsCents += a.currentBalanceCents;
      else liabilitiesCents += Math.abs(a.currentBalanceCents);
    }

    const budget = await this.getMonthBudget(month);
    const upcomingBills = (await this.listRecurringBills(referenceDate)).filter((b) => b.active);
    const allTxs = await this.listTransactions({});
    const uncategorizedCount = allTxs.filter((t) => !t.categoryId).length;

    const trendMonths: string[] = [];
    for (let back = 5; back >= 0; back--) {
      trendMonths.push(shiftMonth(month, -back));
    }

    let monthIncomeCents = 0;
    let monthExpenseCents = 0;
    const catSpend = new Map<string, { name: string; color: string; net: number; count: number }>();

    for (const tx of allTxs) {
      if (tx.categoryKind === 'transfer') continue;
      if (tx.postedDate.startsWith(month)) {
        if (tx.amountCents > 0 && (tx.categoryKind === 'income' || !tx.categoryId)) {
          monthIncomeCents += tx.amountCents;
        } else if (tx.amountCents < 0) {
          monthExpenseCents += Math.abs(tx.amountCents);
        } else if (tx.categoryKind === 'expense' && tx.amountCents > 0) {
          monthExpenseCents = Math.max(0, monthExpenseCents - tx.amountCents);
        }

        if (tx.categoryKind !== 'income') {
          const cid = tx.categoryId ?? 'uncategorized';
          const prev = catSpend.get(cid) ?? {
            name: tx.categoryName ?? 'Uncategorized',
            color: tx.categoryColor ?? '#94A3B8',
            net: 0,
            count: 0,
          };
          prev.net += tx.amountCents;
          prev.count += 1;
          catSpend.set(cid, prev);
        }
      }
    }

    const monthlyTrends: MonthlyTrendPoint[] = trendMonths.map((ym) => {
      let inc = 0;
      let exp = 0;
      for (const tx of allTxs) {
        if (tx.categoryKind === 'transfer' || !tx.postedDate.startsWith(ym)) continue;
        if (tx.amountCents > 0) inc += tx.amountCents;
        else exp += Math.abs(tx.amountCents);
      }
      const [y, m] = ym.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      return { month: ym, label, incomeCents: inc, expenseCents: exp, netCents: inc - exp };
    });

    const rawCatPoints: CategorySpendingPoint[] = [];
    for (const [cid, info] of catSpend.entries()) {
      const spent = Math.max(0, -info.net);
      if (spent > 0) {
        rawCatPoints.push({
          categoryId: cid,
          categoryName: info.name,
          color: info.color,
          amountCents: spent,
          transactionCount: info.count,
          percentage: 0,
        });
      }
    }
    rawCatPoints.sort((a, b) => b.amountCents - a.amountCents);
    const totalCat = rawCatPoints.reduce((acc, p) => acc + p.amountCents, 0);
    if (totalCat > 0) {
      for (const p of rawCatPoints) {
        p.percentage = Math.round((p.amountCents / totalCat) * 1000) / 10;
      }
    }

    return {
      month,
      assetsCents,
      liabilitiesCents,
      netWorthCents,
      monthIncomeCents,
      monthExpenseCents,
      monthNetCents: monthIncomeCents - monthExpenseCents,
      totalBudgetedCents: budget.totalBudgetedCents,
      totalBudgetSpentCents: budget.totalSpentCents,
      uncategorizedCount,
      accounts,
      upcomingBills,
      monthlyTrends,
      topSpendingCategories: rawCatPoints,
      recentTransactions: allTxs.slice(0, 12),
    };
  },

  async exportBackupJson(): Promise<string> {
    const s = loadStore();
    const payload = {
      accounts: s.accounts,
      categories: s.categories,
      categoryRules: s.categoryRules,
      transactions: s.transactions,
      budgets: s.budgets,
      recurringBills: s.recurringBills,
    };
    const canonical = JSON.stringify(payload);
    const sha256 = simpleHash(canonical);
    return JSON.stringify(
      {
        app: 'fasten-classic',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        sha256,
        payload,
      },
      null,
      2
    );
  },

  async restoreBackupJson(rawJson: string): Promise<void> {
    let parsed: {
      app?: string;
      schemaVersion?: number;
      sha256?: string;
      payload?: StoreState;
    };
    try {
      parsed = JSON.parse(rawJson.replace(/^\uFEFF/, '').trim());
    } catch {
      throw new Error('Could not read this backup file. Select a valid Fasten Classic (.fastenbackup.json) file.');
    }
    if (parsed.app !== 'fasten-classic' || !parsed.payload) {
      throw new Error('Unrecognized backup format. Expected a Fasten Classic backup file.');
    }
    // Verify browser hash if generated by browser fallback (16-char) or accept valid 64-char SHA-256 from desktop
    if (parsed.sha256 && parsed.sha256.length === 16) {
      const check = simpleHash(JSON.stringify(parsed.payload));
      if (check !== parsed.sha256) {
        throw new Error('Backup integrity check failed: file contents do not match checksum.');
      }
    }
    saveStore(parsed.payload);
  },

  async getStorageInfo(): Promise<StorageInfo> {
    const s = loadStore();
    const raw = localStorage.getItem(STORAGE_KEY) ?? '';
    return {
      databasePath: 'Browser local preview store (fastenclassic.sqlite in desktop app)',
      databaseSizeBytes: raw.length,
      accountCount: s.accounts.length,
      transactionCount: s.transactions.length,
      categoryCount: s.categories.length,
      ruleCount: s.categoryRules.length,
      billCount: s.recurringBills.length,
    };
  },

  async resetAllData(): Promise<void> {
    saveStore(emptyStore());
  },

  async loadSampleHouseholdData(referenceMonth: string): Promise<void> {
    await this.resetAllData();
    const prevYm = shiftMonth(referenceMonth, -1);
    const curYm = referenceMonth;
    const nextYm = shiftMonth(referenceMonth, 1);

    const checking = await this.upsertAccount({
      id: 'acc-checking',
      name: 'Household Checking',
      accountType: 'checking',
      institution: 'First Federal Credit Union',
      openingBalanceCents: 485_000,
      openingDate: `${prevYm}-01`,
      notes: 'Primary joint checking for paychecks and monthly bills',
    });
    const savings = await this.upsertAccount({
      id: 'acc-savings',
      name: 'Emergency Savings',
      accountType: 'savings',
      institution: 'First Federal Credit Union',
      openingBalanceCents: 2_450_000,
      openingDate: `${prevYm}-01`,
      notes: '6-month household emergency reserve',
    });
    const card = await this.upsertAccount({
      id: 'acc-visa',
      name: 'Everyday Rewards Visa',
      accountType: 'credit_card',
      institution: 'Harbor Bank',
      openingBalanceCents: -42_500,
      openingDate: `${prevYm}-01`,
      notes: 'Groceries, fuel, and everyday household spending',
    });
    await this.upsertAccount({
      id: 'acc-retirement',
      name: 'Household Index Retirement',
      accountType: 'investment',
      institution: 'Vanguard',
      openingBalanceCents: 8_420_000,
      openingDate: `${prevYm}-01`,
      notes: 'Long-term index retirement account',
    });

    const txs: Array<[string, string, string, string, number, string | null]> = [
      [checking.id, `${prevYm}-01`, 'Employer Payroll', 'Biweekly direct deposit', 315_000, 'cat-income-paycheck'],
      [checking.id, `${prevYm}-02`, 'Oakridge Mortgage', 'Monthly mortgage payment', -185_000, 'cat-housing'],
      [card.id, `${prevYm}-05`, "Trader Joe's", 'Weekly groceries', -14_280, 'cat-groceries'],
      [checking.id, `${prevYm}-10`, 'City Electric & Gas', 'Monthly electric utility', -13_840, 'cat-utilities'],
      [checking.id, `${prevYm}-15`, 'Employer Payroll', 'Biweekly direct deposit', 315_000, 'cat-income-paycheck'],
      [card.id, `${prevYm}-18`, 'Whole Foods Market', 'Produce & pantry', -16_420, 'cat-groceries'],
      [card.id, `${prevYm}-21`, 'Shell', 'Regular unleaded', -4_850, 'cat-transport'],
      [checking.id, `${prevYm}-25`, 'Harbor Visa Autopay', 'Pay credit card statement', -50_000, 'cat-transfer'],
      [card.id, `${prevYm}-25`, 'Payment Thank You', 'Autopay received', 50_000, 'cat-transfer'],
      [checking.id, `${prevYm}-28`, 'Savings Transfer', 'Monthly emergency fund transfer', -40_000, 'cat-transfer'],
      [savings.id, `${prevYm}-28`, 'Savings Transfer', 'Monthly emergency fund transfer', 40_000, 'cat-transfer'],

      [checking.id, `${curYm}-01`, 'Employer Payroll', 'Biweekly direct deposit', 315_000, 'cat-income-paycheck'],
      [checking.id, `${curYm}-02`, 'Oakridge Mortgage', 'Monthly mortgage payment', -185_000, 'cat-housing'],
      [card.id, `${curYm}-04`, "Trader Joe's", 'Weekly household groceries', -15_640, 'cat-groceries'],
      [checking.id, `${curYm}-07`, 'Xfinity Internet', 'Home fiber internet', -7_500, 'cat-utilities'],
      [card.id, `${curYm}-09`, 'Blue Bottle Coffee', 'Saturday morning coffee', -1_480, 'cat-dining'],
      [card.id, `${curYm}-11`, 'Shell', 'Highway fill-up', -5_120, 'cat-transport'],
      [card.id, `${curYm}-13`, 'CVS Pharmacy', 'Prescription & household essentials', -3_490, 'cat-healthcare'],
      [checking.id, `${curYm}-15`, 'Employer Payroll', 'Biweekly direct deposit', 315_000, 'cat-income-paycheck'],
      [card.id, `${curYm}-16`, 'Costco', 'Bulk pantry & paper goods', -21_850, 'cat-groceries'],
      [card.id, `${curYm}-19`, 'Amazon', 'Kitchen storage & lightbulbs', -6_420, 'cat-household'],
      [card.id, `${curYm}-21`, 'Netflix', 'Monthly family plan', -2_299, 'cat-subscriptions'],
      [card.id, `${curYm}-23`, 'Local Bistro', 'Anniversary dinner', -9_650, 'cat-dining'],
      [card.id, `${curYm}-24`, 'CORNER HARDWARE #402', 'Garden hose & brackets', -3_875, null],
    ];

    for (const [accountId, postedDate, payee, memo, amountCents, categoryId] of txs) {
      await this.upsertTransaction({
        accountId,
        postedDate,
        payee,
        memo,
        amountCents,
        categoryId,
        cleared: true,
      });
    }

    const budgets: Array<[string, number]> = [
      ['cat-housing', 185_000],
      ['cat-groceries', 65_000],
      ['cat-utilities', 26_000],
      ['cat-transport', 18_000],
      ['cat-dining', 22_000],
      ['cat-household', 20_000],
      ['cat-healthcare', 12_000],
      ['cat-subscriptions', 6_500],
    ];
    for (const [cid, lim] of budgets) {
      await this.setCategoryBudget(curYm, cid, lim);
    }

    await this.upsertRecurringBill(
      {
        name: 'City Electric & Gas',
        payee: 'City Electric & Gas',
        amountCents: 14_200,
        categoryId: 'cat-utilities',
        accountId: checking.id,
        frequency: 'monthly',
        nextDueDate: `${nextYm}-03`,
        autoPay: false,
        notes: 'Check meter reading on winter bills',
        active: true,
      },
      `${curYm}-28`
    );
    await this.upsertRecurringBill(
      {
        name: 'Oakridge Mortgage',
        payee: 'Oakridge Mortgage',
        amountCents: 185_000,
        categoryId: 'cat-housing',
        accountId: checking.id,
        frequency: 'monthly',
        nextDueDate: `${nextYm}-02`,
        autoPay: true,
        notes: 'Auto-drafted on the 2nd',
        active: true,
      },
      `${curYm}-28`
    );
    await this.upsertRecurringBill(
      {
        name: 'Auto & Home Insurance',
        payee: 'Mutual Family Insurance',
        amountCents: 16_800,
        categoryId: 'cat-insurance',
        accountId: checking.id,
        frequency: 'monthly',
        nextDueDate: `${nextYm}-12`,
        autoPay: true,
        notes: 'Combined household policy',
        active: true,
      },
      `${curYm}-28`
    );
  },

  async listSecurities(): Promise<Security[]> {
    return [
      { id: 'sec-voo', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', securityType: 'etf', currentPriceCents: 51240, currency: 'USD', updatedAt: '2026-10-31T00:00:00Z' },
      { id: 'sec-aapl', symbol: 'AAPL', name: 'Apple Inc.', securityType: 'stock', currentPriceCents: 22850, currency: 'USD', updatedAt: '2026-10-31T00:00:00Z' },
      { id: 'sec-msft', symbol: 'MSFT', name: 'Microsoft Corp.', securityType: 'stock', currentPriceCents: 42500, currency: 'USD', updatedAt: '2026-10-31T00:00:00Z' },
      { id: 'sec-bnd', symbol: 'BND', name: 'Vanguard Total Bond Market ETF', securityType: 'etf', currentPriceCents: 7320, currency: 'USD', updatedAt: '2026-10-31T00:00:00Z' },
    ];
  },

  async recordInvestmentTx(input: RecordInvestmentTxInput): Promise<InvestmentTransaction> {
    return {
      id: input.id || `inv-tx-${Date.now()}`,
      accountId: input.accountId,
      securityId: input.securityId,
      action: input.action,
      txDate: input.txDate,
      sharesMicros: input.sharesMicros,
      pricePerShareCents: input.pricePerShareCents,
      commissionCents: input.commissionCents ?? 0,
      totalAmountCents: input.totalAmountCents ?? Math.round((input.sharesMicros * input.pricePerShareCents) / 1_000_000),
      memo: input.memo ?? '',
      createdAt: new Date().toISOString(),
    };
  },

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    const holdings: HoldingSummary[] = [
      {
        securityId: 'sec-voo',
        symbol: 'VOO',
        name: 'Vanguard S&P 500 ETF',
        securityType: 'etf',
        totalSharesMicros: 45_000_000, // 45.0 shares
        totalCostCents: 2_115_000,      // $21,150 ($470/share)
        avgCostPerShareCents: 47_000,
        currentPriceCents: 51_240,     // $512.40
        marketValueCents: 2_305_800,   // $23,058
        unrealizedGainCents: 190_800,  // +$1,908
        unrealizedGainPercent: 9.02,
      },
      {
        securityId: 'sec-aapl',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        securityType: 'stock',
        totalSharesMicros: 30_000_000, // 30.0 shares
        totalCostCents: 570_000,       // $5,700 ($190/share)
        avgCostPerShareCents: 19_000,
        currentPriceCents: 22_850,     // $228.50
        marketValueCents: 685_500,     // $6,855
        unrealizedGainCents: 115_500,  // +$1,155
        unrealizedGainPercent: 20.26,
      },
      {
        securityId: 'sec-msft',
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        securityType: 'stock',
        totalSharesMicros: 15_000_000, // 15.0 shares
        totalCostCents: 600_000,       // $6,000 ($400/share)
        avgCostPerShareCents: 40_000,
        currentPriceCents: 42_500,     // $425.00
        marketValueCents: 637_500,     // $6,375
        unrealizedGainCents: 37_500,   // +$375
        unrealizedGainPercent: 6.25,
      },
      {
        securityId: 'sec-bnd',
        symbol: 'BND',
        name: 'Vanguard Total Bond Market ETF',
        securityType: 'etf',
        totalSharesMicros: 100_000_000, // 100.0 shares
        totalCostCents: 750_000,        // $7,500 ($75/share)
        avgCostPerShareCents: 7_500,
        currentPriceCents: 7_320,       // $73.20
        marketValueCents: 732_000,      // $7,320
        unrealizedGainCents: -18_000,   // -$180
        unrealizedGainPercent: -2.40,
      },
    ];

    const totalCostBasisCents = holdings.reduce((sum, h) => sum + h.totalCostCents, 0);
    const totalMarketValueCents = holdings.reduce((sum, h) => sum + h.marketValueCents, 0);
    const totalUnrealizedGainCents = totalMarketValueCents - totalCostBasisCents;

    return {
      totalMarketValueCents,
      totalCostBasisCents,
      totalUnrealizedGainCents,
      holdings,
      transactions: [
        {
          id: 'inv-tx-1',
          accountId: 'acc-brokerage',
          securityId: 'sec-voo',
          action: 'buy',
          txDate: '2026-01-15',
          sharesMicros: 45_000_000,
          pricePerShareCents: 47_000,
          commissionCents: 0,
          totalAmountCents: 2_115_000,
          memo: 'Initial S&P 500 allocation',
          createdAt: '2026-01-15T10:00:00Z',
        },
        {
          id: 'inv-tx-2',
          accountId: 'acc-brokerage',
          securityId: 'sec-aapl',
          action: 'buy',
          txDate: '2026-02-10',
          sharesMicros: 30_000_000,
          pricePerShareCents: 19_000,
          commissionCents: 0,
          totalAmountCents: 570_000,
          memo: 'Tech equity position',
          createdAt: '2026-02-10T11:00:00Z',
        },
      ],
    };
  },

  async getTaxScheduleReport(year: number): Promise<TaxYearReport> {
    const txs = await this.listTransactions({});
    const yearTxs = txs.filter((t) => t.postedDate.startsWith(`${year}-`));

    const schedules: TaxScheduleItem[] = [
      {
        scheduleName: 'Schedule A (Itemized Deductions)',
        categoryId: 'cat-housing',
        categoryName: 'Mortgage Interest & Property Tax',
        totalAmountCents: 1_240_000,
        transactionCount: 12,
      },
      {
        scheduleName: 'Schedule A (Itemized Deductions)',
        categoryId: 'cat-giving',
        categoryName: 'Charitable Donations',
        totalAmountCents: 320_000,
        transactionCount: 8,
      },
      {
        scheduleName: 'Schedule C (Business / Self-Employment)',
        categoryId: 'cat-professional',
        categoryName: 'Office & Professional Supplies',
        totalAmountCents: 485_000,
        transactionCount: 14,
      },
      {
        scheduleName: '1099-INT / 1099-DIV (Investment Income)',
        categoryId: 'cat-interest',
        categoryName: 'High Yield Savings & Dividend Income',
        totalAmountCents: 284_000,
        transactionCount: 12,
      },
    ];

    const totalDeductionsCents = 1_240_000 + 320_000 + 485_000;
    const totalTaxableIncomeCents = 12_800_000;

    return {
      year,
      totalDeductionsCents,
      totalTaxableIncomeCents,
      standardDeductionSingleCents: 1_500_000,
      standardDeductionMarriedCents: 3_000_000,
      schedules,
      transactions: yearTxs,
    };
  },

  async calculateLoanAmortization(
    principalCents: number,
    aprBasisPoints: number,
    termMonths: number,
    extraMonthlyCents: number
  ): Promise<LoanCalculation> {
    const monthlyRate = (aprBasisPoints / 10000.0) / 12.0;
    let baseMonthlyPayment = 0;
    if (monthlyRate === 0) {
      baseMonthlyPayment = Math.round(principalCents / termMonths);
    } else {
      const factor = Math.pow(1.0 + monthlyRate, termMonths);
      baseMonthlyPayment = Math.round((principalCents * (monthlyRate * factor)) / (factor - 1.0));
    }

    const schedule: AmortizationMonth[] = [];
    let remaining = principalCents;
    let totalInterest = 0;
    let totalPaid = 0;

    for (let m = 1; m <= termMonths && remaining > 0; m++) {
      let interest = Math.round(remaining * monthlyRate);
      let targetPayment = baseMonthlyPayment + extraMonthlyCents;
      if (m >= termMonths && extraMonthlyCents === 0) {
        targetPayment = remaining + interest;
      }
      let principalPaid = targetPayment - interest;
      if (principalPaid >= remaining) {
        principalPaid = remaining;
        targetPayment = principalPaid + interest;
        remaining = 0;
      } else {
        remaining -= principalPaid;
      }
      totalInterest += interest;
      totalPaid += targetPayment;

      schedule.push({
        monthIndex: m,
        date: `Month ${m}`,
        paymentCents: targetPayment,
        principalCents: principalPaid,
        interestCents: interest,
        remainingBalanceCents: remaining,
      });

      if (remaining === 0) break;
    }

    return {
      principalCents,
      interestRateBasisPoints: aprBasisPoints,
      termMonths,
      monthlyPaymentCents: baseMonthlyPayment + extraMonthlyCents,
      totalInterestCents: totalInterest,
      totalPaidCents: totalPaid,
      schedule,
    };
  },

  async compareLoanPayoff(
    principalCents: number,
    aprBasisPoints: number,
    termMonths: number,
    extraMonthlyCents: number
  ): Promise<LoanPayoffComparison> {
    const std = await this.calculateLoanAmortization(principalCents, aprBasisPoints, termMonths, 0);
    const acc = await this.calculateLoanAmortization(principalCents, aprBasisPoints, termMonths, extraMonthlyCents);

    const standardMonths = std.schedule.length;
    const standardTotalInterestCents = std.totalInterestCents;
    const acceleratedMonths = acc.schedule.length;
    const acceleratedTotalInterestCents = acc.totalInterestCents;

    return {
      standardMonths,
      standardTotalInterestCents,
      acceleratedMonths,
      acceleratedTotalInterestCents,
      monthsSaved: Math.max(0, standardMonths - acceleratedMonths),
      interestSavedCents: Math.max(0, standardTotalInterestCents - acceleratedTotalInterestCents),
    };
  },

  async convertNumberToEnglishWords(amountCents: number): Promise<string> {
    const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function smallToWords(n: number): string {
      if (n === 0) return '';
      if (n < 20) return ONES[n];
      if (n < 100) {
        const rem = n % 10;
        return rem === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ONES[rem]}`;
      }
      const hundred = Math.floor(n / 100);
      const rem = n % 100;
      if (rem === 0) return `${ONES[hundred]} Hundred`;
      return `${ONES[hundred]} Hundred ${smallToWords(rem)}`;
    }

    const dollars = Math.floor(Math.abs(amountCents) / 100);
    const cents = Math.abs(amountCents) % 100;

    let dollarPart = '';
    if (dollars === 0) {
      dollarPart = 'Zero';
    } else {
      const millions = Math.floor(dollars / 1_000_000);
      const thousands = Math.floor((dollars % 1_000_000) / 1_000);
      const remainder = dollars % 1_000;
      const parts: string[] = [];
      if (millions > 0) parts.push(`${smallToWords(millions)} Million`);
      if (thousands > 0) parts.push(`${smallToWords(thousands)} Thousand`);
      if (remainder > 0) parts.push(smallToWords(remainder));
      dollarPart = parts.join(' ');
    }

    const centsStr = cents.toString().padStart(2, '0');
    return `${dollarPart} and ${centsStr}/100 Dollars`;
  },

  async listCurrencyRates(): Promise<CurrencyRate[]> {
    return [
      { code: 'USD', name: 'United States Dollar', symbol: '$', rateToUsdMicros: 1_000_000, updatedAt: '2026-10-31T00:00:00Z' },
      { code: 'EUR', name: 'Euro', symbol: '€', rateToUsdMicros: 1_085_000, updatedAt: '2026-10-31T00:00:00Z' },
      { code: 'GBP', name: 'British Pound Sterling', symbol: '£', rateToUsdMicros: 1_295_000, updatedAt: '2026-10-31T00:00:00Z' },
      { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', rateToUsdMicros: 720_000, updatedAt: '2026-10-31T00:00:00Z' },
      { code: 'JPY', name: 'Japanese Yen', symbol: '¥', rateToUsdMicros: 6_550, updatedAt: '2026-10-31T00:00:00Z' },
    ];
  },

  async upsertCurrencyRate(input: UpsertCurrencyRateInput): Promise<CurrencyRate> {
    return {
      code: input.code.toUpperCase(),
      name: input.name,
      symbol: input.symbol,
      rateToUsdMicros: input.rateToUsdMicros,
      updatedAt: new Date().toISOString(),
    };
  },

  async getIncomeExpenseReport(startDate: string, endDate: string): Promise<IncomeExpenseReport> {
    const txs = await this.listTransactions({});
    const categories = await this.listCategories();
    const catMap = new Map(categories.map((c) => [c.id, c]));

    const filtered = txs.filter((t) => t.postedDate >= startDate && t.postedDate <= endDate);

    let totalIncomeCents = 0;
    let totalExpenseCents = 0;
    const catTotals: Record<string, number> = {};
    const payeeStats: Record<string, { count: number; total: number }> = {};

    for (const t of filtered) {
      if (t.amountCents > 0) {
        totalIncomeCents += t.amountCents;
      } else {
        const expense = Math.abs(t.amountCents);
        totalExpenseCents += expense;
        const cId = t.categoryId || 'uncategorized';
        catTotals[cId] = (catTotals[cId] || 0) + expense;

        const p = t.payee.trim() || 'Unknown Payee';
        if (!payeeStats[p]) payeeStats[p] = { count: 0, total: 0 };
        payeeStats[p].count += 1;
        payeeStats[p].total += expense;
      }
    }

    const netSavingsCents = totalIncomeCents - totalExpenseCents;
    const savingsRatePercent = totalIncomeCents > 0
      ? Math.round((netSavingsCents / totalIncomeCents) * 1000) / 10
      : 0;

    const categoryBreakdown: CategorySpendingPoint[] = Object.entries(catTotals).map(([cId, spent]) => {
      const cat = catMap.get(cId);
      return {
        categoryId: cId,
        categoryName: cat ? cat.name : 'Uncategorized',
        color: cat?.color ?? '#444444',
        amountCents: spent,
        transactionCount: 1,
        percentage: totalExpenseCents > 0 ? Math.round((spent / totalExpenseCents) * 1000) / 10 : 0,
      };
    }).sort((a, b) => b.amountCents - a.amountCents);

    const topPayees: PayeeSpendingPoint[] = Object.entries(payeeStats).map(([payee, stat]) => ({
      payee,
      transactionCount: stat.count,
      totalSpentCents: stat.total,
      averageSpentCents: stat.count > 0 ? Math.round(stat.total / stat.count) : 0,
    })).sort((a, b) => b.totalSpentCents - a.totalSpentCents).slice(0, 15);

    return {
      startDate,
      endDate,
      totalIncomeCents,
      totalExpenseCents,
      netSavingsCents,
      savingsRatePercent,
      categoryBreakdown,
      topPayees,
    };
  },
};
