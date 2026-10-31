import { invoke } from '@tauri-apps/api/core';
import type {
  Account,
  Category,
  CategoryRule,
  CommitImportRequest,
  CommitImportResult,
  CurrencyRate,
  DashboardSummary,
  ImportPreviewRequest,
  ImportPreviewResponse,
  IncomeExpenseReport,
  InvestmentTransaction,
  LoanCalculation,
  LoanPayoffComparison,
  MonthBudgetSummary,
  PortfolioSummary,
  RecurringBill,
  Security,
  StorageInfo,
  TaxYearReport,
  Transaction,
  TransactionFilter,
  UpsertAccountInput,
  UpsertCategoryInput,
  UpsertCategoryRuleInput,
  RecordInvestmentTxInput,
  UpsertCurrencyRateInput,
  UpsertRecurringBillInput,
  UpsertTransactionInput,
} from '../types';
import { localFallbackApi } from './localFallback';

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const api = {
  getDashboardSummary(month: string, referenceDate: string): Promise<DashboardSummary> {
    if (!isTauriDesktop()) return localFallbackApi.getDashboardSummary(month, referenceDate);
    return invoke('get_dashboard_summary', { month, referenceDate });
  },

  listAccounts(): Promise<Account[]> {
    if (!isTauriDesktop()) return localFallbackApi.listAccounts();
    return invoke('list_accounts');
  },

  upsertAccount(input: UpsertAccountInput): Promise<Account> {
    if (!isTauriDesktop()) return localFallbackApi.upsertAccount(input);
    return invoke('upsert_account', { input });
  },

  deleteAccount(accountId: string): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.deleteAccount(accountId);
    return invoke('delete_account', { accountId });
  },

  listCategories(): Promise<Category[]> {
    if (!isTauriDesktop()) return localFallbackApi.listCategories();
    return invoke('list_categories');
  },

  upsertCategory(input: UpsertCategoryInput): Promise<Category> {
    if (!isTauriDesktop()) return localFallbackApi.upsertCategory(input);
    return invoke('upsert_category', { input });
  },

  deleteCategory(categoryId: string): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.deleteCategory(categoryId);
    return invoke('delete_category', { categoryId });
  },

  listCategoryRules(): Promise<CategoryRule[]> {
    if (!isTauriDesktop()) return localFallbackApi.listCategoryRules();
    return invoke('list_category_rules');
  },

  upsertCategoryRule(input: UpsertCategoryRuleInput): Promise<CategoryRule> {
    if (!isTauriDesktop()) return localFallbackApi.upsertCategoryRule(input);
    return invoke('upsert_category_rule', { input });
  },

  deleteCategoryRule(ruleId: string): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.deleteCategoryRule(ruleId);
    return invoke('delete_category_rule', { ruleId });
  },

  applyCategoryRules(onlyUncategorized: boolean): Promise<number> {
    if (!isTauriDesktop()) return localFallbackApi.applyCategoryRules(onlyUncategorized);
    return invoke('apply_category_rules', { onlyUncategorized });
  },

  listTransactions(filter: TransactionFilter): Promise<Transaction[]> {
    if (!isTauriDesktop()) return localFallbackApi.listTransactions(filter);
    return invoke('list_transactions', { filter });
  },

  upsertTransaction(input: UpsertTransactionInput): Promise<Transaction> {
    if (!isTauriDesktop()) return localFallbackApi.upsertTransaction(input);
    return invoke('upsert_transaction', { input });
  },

  assignTransactionCategory(
    transactionId: string,
    categoryId: string | null,
    createRulePattern?: string | null
  ): Promise<number> {
    if (!isTauriDesktop()) {
      return localFallbackApi.assignTransactionCategory(
        transactionId,
        categoryId,
        createRulePattern
      );
    }
    return invoke('assign_transaction_category', {
      transactionId,
      categoryId,
      createRulePattern: createRulePattern ?? null,
    });
  },

  deleteTransaction(transactionId: string): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.deleteTransaction(transactionId);
    return invoke('delete_transaction', { transactionId });
  },

  previewStatementImport(request: ImportPreviewRequest): Promise<ImportPreviewResponse> {
    if (!isTauriDesktop()) return localFallbackApi.previewStatementImport(request);
    return invoke('preview_statement_import', { request });
  },

  commitStatementImport(request: CommitImportRequest): Promise<CommitImportResult> {
    if (!isTauriDesktop()) return localFallbackApi.commitStatementImport(request);
    return invoke('commit_statement_import', { request });
  },

  getMonthBudget(month: string): Promise<MonthBudgetSummary> {
    if (!isTauriDesktop()) return localFallbackApi.getMonthBudget(month);
    return invoke('get_month_budget', { month });
  },

  setCategoryBudget(month: string, categoryId: string, limitCents: number): Promise<void> {
    if (!isTauriDesktop()) {
      return localFallbackApi.setCategoryBudget(month, categoryId, limitCents);
    }
    return invoke('set_category_budget', { month, categoryId, limitCents });
  },

  copyPreviousMonthBudget(targetMonth: string): Promise<number> {
    if (!isTauriDesktop()) return localFallbackApi.copyPreviousMonthBudget(targetMonth);
    return invoke('copy_previous_month_budget', { targetMonth });
  },

  listRecurringBills(referenceDate: string): Promise<RecurringBill[]> {
    if (!isTauriDesktop()) return localFallbackApi.listRecurringBills(referenceDate);
    return invoke('list_recurring_bills', { referenceDate });
  },

  upsertRecurringBill(
    input: UpsertRecurringBillInput,
    referenceDate: string
  ): Promise<RecurringBill> {
    if (!isTauriDesktop()) return localFallbackApi.upsertRecurringBill(input, referenceDate);
    return invoke('upsert_recurring_bill', { input, referenceDate });
  },

  deleteRecurringBill(billId: string): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.deleteRecurringBill(billId);
    return invoke('delete_recurring_bill', { billId });
  },

  recordBillPayment(
    billId: string,
    paidDate: string,
    accountIdOverride?: string | null
  ): Promise<Transaction> {
    if (!isTauriDesktop()) {
      return localFallbackApi.recordBillPayment(billId, paidDate, accountIdOverride);
    }
    return invoke('record_bill_payment', {
      billId,
      paidDate,
      accountIdOverride: accountIdOverride ?? null,
    });
  },

  exportBackupJson(): Promise<string> {
    if (!isTauriDesktop()) return localFallbackApi.exportBackupJson();
    return invoke('export_backup_json');
  },

  exportBackupToFile(filePath: string): Promise<void> {
    return invoke('export_backup_to_file', { filePath });
  },

  restoreBackupJson(rawJson: string): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.restoreBackupJson(rawJson);
    return invoke('restore_backup_json', { rawJson });
  },

  restoreBackupFromFile(filePath: string): Promise<void> {
    return invoke('restore_backup_from_file', { filePath });
  },

  getStorageInfo(): Promise<StorageInfo> {
    if (!isTauriDesktop()) return localFallbackApi.getStorageInfo();
    return invoke('get_storage_info');
  },

  loadSampleHouseholdData(referenceMonth: string): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.loadSampleHouseholdData(referenceMonth);
    return invoke('load_sample_household_data', { referenceMonth });
  },

  resetAllData(): Promise<void> {
    if (!isTauriDesktop()) return localFallbackApi.resetAllData();
    return invoke('reset_all_data');
  },

  listSecurities(): Promise<Security[]> {
    if (!isTauriDesktop()) return localFallbackApi.listSecurities();
    return invoke('list_securities');
  },

  recordInvestmentTx(input: RecordInvestmentTxInput): Promise<InvestmentTransaction> {
    if (!isTauriDesktop()) return localFallbackApi.recordInvestmentTx(input);
    return invoke('record_investment_tx', { input });
  },

  getPortfolioSummary(): Promise<PortfolioSummary> {
    if (!isTauriDesktop()) return localFallbackApi.getPortfolioSummary();
    return invoke('get_portfolio_summary');
  },

  getTaxScheduleReport(year: number): Promise<TaxYearReport> {
    if (!isTauriDesktop()) return localFallbackApi.getTaxScheduleReport(year);
    return invoke('get_tax_schedule_report', { year });
  },

  calculateLoanAmortization(
    principalCents: number,
    aprBasisPoints: number,
    termMonths: number,
    extraMonthlyCents: number
  ): Promise<LoanCalculation> {
    if (!isTauriDesktop()) {
      return localFallbackApi.calculateLoanAmortization(
        principalCents,
        aprBasisPoints,
        termMonths,
        extraMonthlyCents
      );
    }
    return invoke('calculate_loan_amortization', {
      principalCents,
      aprBasisPoints,
      termMonths,
      extraMonthlyCents,
    });
  },

  compareLoanPayoff(
    principalCents: number,
    aprBasisPoints: number,
    termMonths: number,
    extraMonthlyCents: number
  ): Promise<LoanPayoffComparison> {
    if (!isTauriDesktop()) {
      return localFallbackApi.compareLoanPayoff(
        principalCents,
        aprBasisPoints,
        termMonths,
        extraMonthlyCents
      );
    }
    return invoke('compare_loan_payoff', {
      principalCents,
      aprBasisPoints,
      termMonths,
      extraMonthlyCents,
    });
  },

  convertNumberToEnglishWords(amountCents: number): Promise<string> {
    if (!isTauriDesktop()) return localFallbackApi.convertNumberToEnglishWords(amountCents);
    return invoke('convert_number_to_english_words', { amountCents });
  },

  listCurrencyRates(): Promise<CurrencyRate[]> {
    if (!isTauriDesktop()) return localFallbackApi.listCurrencyRates();
    return invoke('list_currency_rates');
  },

  upsertCurrencyRate(input: UpsertCurrencyRateInput): Promise<CurrencyRate> {
    if (!isTauriDesktop()) return localFallbackApi.upsertCurrencyRate(input);
    return invoke('upsert_currency_rate', { input });
  },

  getIncomeExpenseReport(startDate: string, endDate: string): Promise<IncomeExpenseReport> {
    if (!isTauriDesktop()) return localFallbackApi.getIncomeExpenseReport(startDate, endDate);
    return invoke('get_income_expense_report', { startDate, endDate });
  },
};
