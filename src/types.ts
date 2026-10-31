export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'investment'
  | 'loan'
  | 'cash';

export interface Account {
  id: string;
  name: string;
  accountType: AccountType;
  institution: string;
  openingBalanceCents: number;
  openingDate: string;
  currentBalanceCents: number;
  transactionCount: number;
  notes: string;
  createdAt: string;
  currency?: string | null;
  interestRateBasisPoints?: number | null;
  termMonths?: number | null;
  monthlyPaymentCents?: number | null;
}

export interface UpsertAccountInput {
  id?: string;
  name: string;
  accountType: AccountType;
  institution: string;
  openingBalanceCents: number;
  openingDate: string;
  notes?: string;
  currency?: string | null;
  interestRateBasisPoints?: number | null;
  termMonths?: number | null;
  monthlyPaymentCents?: number | null;
}

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  groupName: string;
  kind: CategoryKind;
  color: string;
  taxSchedule?: string | null;
}

export interface UpsertCategoryInput {
  id?: string;
  name: string;
  groupName: string;
  kind: CategoryKind;
  color: string;
  taxSchedule?: string | null;
}

export type RuleMatchType = 'contains' | 'starts_with' | 'exact';

export interface CategoryRule {
  id: string;
  pattern: string;
  matchType: RuleMatchType;
  categoryId: string;
  categoryName?: string | null;
  renamePayee?: string | null;
  accountId?: string | null;
  priority: number;
}

export interface UpsertCategoryRuleInput {
  id?: string;
  pattern: string;
  matchType: RuleMatchType;
  categoryId: string;
  renamePayee?: string | null;
  accountId?: string | null;
  priority: number;
}

export interface TransactionSplit {
  id: string;
  transactionId: string;
  categoryId: string;
  categoryName?: string | null;
  categoryColor?: string | null;
  amountCents: number;
  memo: string;
}

export interface TransactionSplitInput {
  id?: string;
  categoryId?: string | null;
  amountCents: number;
  memo?: string | null;
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName?: string | null;
  postedDate: string;
  payee: string;
  originalPayee: string;
  memo: string;
  amountCents: number;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryKind?: CategoryKind | null;
  categoryColor?: string | null;
  externalId?: string | null;
  fingerprint: string;
  cleared: boolean;
  checkNumber?: string | null;
  isSplit?: boolean;
  splits?: TransactionSplit[];
  importSource?: string | null;
  createdAt: string;
}

export interface UpsertTransactionInput {
  id?: string;
  accountId: string;
  postedDate: string;
  payee: string;
  memo?: string;
  amountCents: number;
  categoryId?: string | null;
  cleared?: boolean;
  checkNumber?: string | null;
  splits?: TransactionSplitInput[] | null;
}

export interface TransactionFilter {
  accountId?: string;
  categoryId?: string;
  month?: string;
  search?: string;
  uncategorizedOnly?: boolean;
}

export interface CsvColumnMapping {
  dateCol?: number | null;
  payeeCol?: number | null;
  memoCol?: number | null;
  amountCol?: number | null;
  debitCol?: number | null;
  creditCol?: number | null;
  externalIdCol?: number | null;
  invertAmount?: boolean | null;
}

export interface ImportPreviewRequest {
  accountId: string;
  fileName: string;
  content: string;
  formatOverride?: string | null;
  csvMapping?: CsvColumnMapping | null;
}

export interface ImportPreviewRow {
  rowIndex: number;
  postedDate: string;
  payee: string;
  originalPayee: string;
  memo: string;
  amountCents: number;
  categoryId?: string | null;
  categoryName?: string | null;
  matchedRuleId?: string | null;
  externalId?: string | null;
  fingerprint: string;
  isDuplicate: boolean;
  duplicateReason?: string | null;
  selected: boolean;
}

export interface ImportPreviewResponse {
  detectedFormat: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  statementBalanceCents?: number | null;
  csvHeaders?: string[] | null;
  inferredCsvMapping?: CsvColumnMapping | null;
  warnings: string[];
  rows: ImportPreviewRow[];
}

export interface CommitImportRow {
  postedDate: string;
  payee: string;
  originalPayee: string;
  memo: string;
  amountCents: number;
  categoryId?: string | null;
  externalId?: string | null;
  fingerprint: string;
}

export interface CommitImportRequest {
  accountId: string;
  sourceName: string;
  rows: CommitImportRow[];
}

export interface CommitImportResult {
  importedCount: number;
  skippedCount: number;
}

export interface BudgetRow {
  categoryId: string;
  categoryName: string;
  groupName: string;
  color: string;
  month: string;
  budgetedCents: number;
  spentCents: number;
  remainingCents: number;
}

export interface MonthBudgetSummary {
  month: string;
  totalBudgetedCents: number;
  totalSpentCents: number;
  totalRemainingCents: number;
  incomeCents: number;
  rows: BudgetRow[];
}

export type BillFrequency = 'monthly' | 'biweekly' | 'quarterly' | 'yearly';

export interface RecurringBill {
  id: string;
  name: string;
  payee: string;
  amountCents: number;
  categoryId?: string | null;
  categoryName?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  frequency: BillFrequency;
  nextDueDate: string;
  autoPay: boolean;
  notes: string;
  active: boolean;
  daysUntilDue: number;
  status: 'overdue' | 'due_soon' | 'upcoming' | 'paused';
}

export interface UpsertRecurringBillInput {
  id?: string;
  name: string;
  payee: string;
  amountCents: number;
  categoryId?: string | null;
  accountId?: string | null;
  frequency: BillFrequency;
  nextDueDate: string;
  autoPay: boolean;
  notes?: string;
  active?: boolean;
}

export interface MonthlyTrendPoint {
  month: string;
  label: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

export interface CategorySpendingPoint {
  categoryId: string;
  categoryName: string;
  color: string;
  amountCents: number;
  transactionCount: number;
  percentage: number;
}

export interface DashboardSummary {
  month: string;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  monthIncomeCents: number;
  monthExpenseCents: number;
  monthNetCents: number;
  totalBudgetedCents: number;
  totalBudgetSpentCents: number;
  uncategorizedCount: number;
  accounts: Account[];
  upcomingBills: RecurringBill[];
  monthlyTrends: MonthlyTrendPoint[];
  topSpendingCategories: CategorySpendingPoint[];
  recentTransactions: Transaction[];
}

export interface StorageInfo {
  databasePath: string;
  databaseSizeBytes: number;
  accountCount: number;
  transactionCount: number;
  categoryCount: number;
  ruleCount: number;
  billCount: number;
}

export type NavSection =
  | 'overview'
  | 'transactions'
  | 'import'
  | 'budgets'
  | 'bills'
  | 'portfolio'
  | 'tax'
  | 'loans'
  | 'reports'
  | 'checks'
  | 'rules'
  | 'backup';

// --- Investment Tracking ---

export type SecurityType = 'stock' | 'etf' | 'mutual_fund' | 'bond' | 'crypto';

export interface Security {
  id: string;
  symbol: string;
  name: string;
  securityType: SecurityType;
  currentPriceCents: number;
  currency: string;
  updatedAt: string;
}

export interface UpsertSecurityInput {
  id?: string;
  symbol: string;
  name: string;
  securityType: SecurityType;
  currentPriceCents: number;
  currency?: string | null;
}

export type InvestmentAction = 'buy' | 'sell' | 'dividend' | 'reinvest' | 'split';

export interface InvestmentTransaction {
  id: string;
  accountId: string;
  accountName?: string | null;
  securityId: string;
  securitySymbol?: string | null;
  securityName?: string | null;
  action: InvestmentAction;
  txDate: string;
  sharesMicros: number; // 1 share = 1_000_000
  pricePerShareCents: number;
  commissionCents: number;
  totalAmountCents: number;
  memo: string;
  createdAt: string;
}

export interface RecordInvestmentTxInput {
  id?: string;
  accountId: string;
  securityId: string;
  action: InvestmentAction;
  txDate: string;
  sharesMicros: number;
  pricePerShareCents: number;
  commissionCents?: number | null;
  totalAmountCents?: number | null;
  memo?: string | null;
}

export interface HoldingSummary {
  securityId: string;
  symbol: string;
  name: string;
  securityType: string;
  totalSharesMicros: number;
  totalCostCents: number;
  avgCostPerShareCents: number;
  currentPriceCents: number;
  marketValueCents: number;
  unrealizedGainCents: number;
  unrealizedGainPercent: number;
}

export interface PortfolioSummary {
  totalMarketValueCents: number;
  totalCostBasisCents: number;
  totalUnrealizedGainCents: number;
  holdings: HoldingSummary[];
  transactions: InvestmentTransaction[];
}

// --- Tax Schedule Reports ---

export interface TaxScheduleItem {
  scheduleName: string;
  categoryId: string;
  categoryName: string;
  totalAmountCents: number;
  transactionCount: number;
}

export interface TaxYearReport {
  year: number;
  totalDeductionsCents: number;
  totalTaxableIncomeCents: number;
  standardDeductionSingleCents: number;
  standardDeductionMarriedCents: number;
  schedules: TaxScheduleItem[];
  transactions: Transaction[];
}

// --- Loan Amortization ---

export interface AmortizationMonth {
  monthIndex: number;
  date: string;
  paymentCents: number;
  principalCents: number;
  interestCents: number;
  remainingBalanceCents: number;
}

export interface LoanCalculation {
  principalCents: number;
  interestRateBasisPoints: number;
  termMonths: number;
  monthlyPaymentCents: number;
  totalInterestCents: number;
  totalPaidCents: number;
  schedule: AmortizationMonth[];
}

export interface LoanPayoffComparison {
  standardMonths: number;
  standardTotalInterestCents: number;
  acceleratedMonths: number;
  acceleratedTotalInterestCents: number;
  monthsSaved: number;
  interestSavedCents: number;
}

// --- Multi-Currency ---

export interface CurrencyRate {
  code: string;
  name: string;
  symbol: string;
  rateToUsdMicros: number;
  updatedAt: string;
}

export interface UpsertCurrencyRateInput {
  code: string;
  name: string;
  symbol: string;
  rateToUsdMicros: number;
}

// --- Advanced Financial Reports ---

export interface FinancialReportFilter {
  startDate?: string | null;
  endDate?: string | null;
  accountId?: string | null;
}

export interface PayeeSpendingPoint {
  payee: string;
  transactionCount: number;
  totalSpentCents: number;
  averageSpentCents: number;
}

export interface IncomeExpenseReport {
  startDate: string;
  endDate: string;
  totalIncomeCents: number;
  totalExpenseCents: number;
  netSavingsCents: number;
  savingsRatePercent: number;
  categoryBreakdown: CategorySpendingPoint[];
  topPayees: PayeeSpendingPoint[];
}
