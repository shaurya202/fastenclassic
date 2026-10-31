use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub account_type: String, // "checking" | "savings" | "credit_card" | "investment" | "loan" | "cash"
    pub institution: String,
    pub opening_balance_cents: i64,
    pub opening_date: String, // YYYY-MM-DD
    pub current_balance_cents: i64,
    pub transaction_count: i64,
    pub notes: String,
    pub created_at: String,
    pub currency: Option<String>,
    pub interest_rate_basis_points: Option<i64>,
    pub term_months: Option<i32>,
    pub monthly_payment_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAccountInput {
    pub id: Option<String>,
    pub name: String,
    pub account_type: String,
    pub institution: String,
    pub opening_balance_cents: i64,
    pub opening_date: String,
    pub notes: Option<String>,
    pub currency: Option<String>,
    pub interest_rate_basis_points: Option<i64>,
    pub term_months: Option<i32>,
    pub monthly_payment_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub group_name: String,
    pub kind: String, // "expense" | "income" | "transfer"
    pub color: String,
    pub tax_schedule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub group_name: String,
    pub kind: String,
    pub color: String,
    pub tax_schedule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRule {
    pub id: String,
    pub pattern: String,
    pub match_type: String, // "contains" | "starts_with" | "exact"
    pub category_id: String,
    pub category_name: Option<String>,
    pub rename_payee: Option<String>,
    pub account_id: Option<String>,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCategoryRuleInput {
    pub id: Option<String>,
    pub pattern: String,
    pub match_type: String,
    pub category_id: String,
    pub rename_payee: Option<String>,
    pub account_id: Option<String>,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSplit {
    pub id: String,
    pub transaction_id: String,
    pub category_id: String,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    pub amount_cents: i64,
    pub memo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSplitInput {
    pub id: Option<String>,
    pub category_id: String,
    pub amount_cents: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub account_id: String,
    pub account_name: Option<String>,
    pub posted_date: String, // YYYY-MM-DD
    pub payee: String,
    pub original_payee: String,
    pub memo: String,
    pub amount_cents: i64, // negative = outflow, positive = inflow
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub category_kind: Option<String>,
    pub category_color: Option<String>,
    pub external_id: Option<String>,
    pub fingerprint: String,
    pub cleared: bool,
    pub check_number: Option<String>,
    pub is_split: bool,
    pub splits: Vec<TransactionSplit>,
    pub import_source: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTransactionInput {
    pub id: Option<String>,
    pub account_id: String,
    pub posted_date: String,
    pub payee: String,
    pub memo: Option<String>,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub cleared: Option<bool>,
    pub check_number: Option<String>,
    pub splits: Option<Vec<TransactionSplitInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransactionFilter {
    pub account_id: Option<String>,
    pub category_id: Option<String>,
    pub month: Option<String>, // YYYY-MM
    pub search: Option<String>,
    pub uncategorized_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CsvColumnMapping {
    pub date_col: Option<usize>,
    pub payee_col: Option<usize>,
    pub memo_col: Option<usize>,
    pub amount_col: Option<usize>,
    pub debit_col: Option<usize>,
    pub credit_col: Option<usize>,
    pub external_id_col: Option<usize>,
    pub invert_amount: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewRequest {
    pub account_id: String,
    pub file_name: String,
    pub content: String,
    pub format_override: Option<String>, // "csv" | "ofx" | "qif"
    pub csv_mapping: Option<CsvColumnMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewRow {
    pub row_index: usize,
    pub posted_date: String,
    pub payee: String,
    pub original_payee: String,
    pub memo: String,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub matched_rule_id: Option<String>,
    pub external_id: Option<String>,
    pub fingerprint: String,
    pub is_duplicate: bool,
    pub duplicate_reason: Option<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewResponse {
    pub detected_format: String,
    pub total_rows: usize,
    pub new_rows: usize,
    pub duplicate_rows: usize,
    pub statement_balance_cents: Option<i64>,
    pub csv_headers: Option<Vec<String>>,
    pub inferred_csv_mapping: Option<CsvColumnMapping>,
    pub warnings: Vec<String>,
    pub rows: Vec<ImportPreviewRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitImportRow {
    pub posted_date: String,
    pub payee: String,
    pub original_payee: String,
    pub memo: String,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub external_id: Option<String>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitImportRequest {
    pub account_id: String,
    pub source_name: String,
    pub rows: Vec<CommitImportRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitImportResult {
    pub imported_count: usize,
    pub skipped_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetRow {
    pub category_id: String,
    pub category_name: String,
    pub group_name: String,
    pub color: String,
    pub month: String,
    pub budgeted_cents: i64,
    pub spent_cents: i64, // positive magnitude of net expense in category
    pub remaining_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthBudgetSummary {
    pub month: String,
    pub total_budgeted_cents: i64,
    pub total_spent_cents: i64,
    pub total_remaining_cents: i64,
    pub income_cents: i64,
    pub rows: Vec<BudgetRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringBill {
    pub id: String,
    pub name: String,
    pub payee: String,
    pub amount_cents: i64, // positive expected bill cost in cents
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub frequency: String, // "monthly" | "biweekly" | "quarterly" | "yearly"
    pub next_due_date: String, // YYYY-MM-DD
    pub auto_pay: bool,
    pub notes: String,
    pub active: bool,
    pub days_until_due: i64,
    pub status: String, // "overdue" | "due_soon" | "upcoming" | "paused"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRecurringBillInput {
    pub id: Option<String>,
    pub name: String,
    pub payee: String,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub account_id: Option<String>,
    pub frequency: String,
    pub next_due_date: String,
    pub auto_pay: bool,
    pub notes: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyTrendPoint {
    pub month: String, // YYYY-MM
    pub label: String, // e.g. "Oct 2026"
    pub income_cents: i64,
    pub expense_cents: i64,
    pub net_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategorySpendingPoint {
    pub category_id: String,
    pub category_name: String,
    pub color: String,
    pub amount_cents: i64,
    pub transaction_count: i64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub month: String,
    pub assets_cents: i64,
    pub liabilities_cents: i64, // positive magnitude of debt balances
    pub net_worth_cents: i64,
    pub month_income_cents: i64,
    pub month_expense_cents: i64,
    pub month_net_cents: i64,
    pub total_budgeted_cents: i64,
    pub total_budget_spent_cents: i64,
    pub uncategorized_count: i64,
    pub accounts: Vec<Account>,
    pub upcoming_bills: Vec<RecurringBill>,
    pub monthly_trends: Vec<MonthlyTrendPoint>,
    pub top_spending_categories: Vec<CategorySpendingPoint>,
    pub recent_transactions: Vec<Transaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBudgetRecord {
    pub id: String,
    pub month: String,
    pub category_id: String,
    pub limit_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTransactionRecord {
    pub id: String,
    pub account_id: String,
    pub posted_date: String,
    pub payee: String,
    pub original_payee: String,
    pub memo: String,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub external_id: Option<String>,
    pub fingerprint: String,
    pub cleared: bool,
    pub check_number: Option<String>,
    pub import_source: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccountRecord {
    pub id: String,
    pub name: String,
    pub account_type: String,
    pub institution: String,
    pub opening_balance_cents: i64,
    pub opening_date: String,
    pub notes: String,
    pub created_at: String,
    pub currency: Option<String>,
    pub interest_rate_basis_points: Option<i64>,
    pub term_months: Option<i32>,
    pub monthly_payment_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCategoryRuleRecord {
    pub id: String,
    pub pattern: String,
    pub match_type: String,
    pub category_id: String,
    pub rename_payee: Option<String>,
    pub account_id: Option<String>,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecurringBillRecord {
    pub id: String,
    pub name: String,
    pub payee: String,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub account_id: Option<String>,
    pub frequency: String,
    pub next_due_date: String,
    pub auto_pay: bool,
    pub notes: String,
    pub active: bool,
}

// --- Investment Tracking Models ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Security {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub security_type: String, // "stock" | "etf" | "mutual_fund" | "bond" | "crypto"
    pub current_price_cents: i64,
    pub currency: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSecurityInput {
    pub id: Option<String>,
    pub symbol: String,
    pub name: String,
    pub security_type: String,
    pub current_price_cents: i64,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentTransaction {
    pub id: String,
    pub account_id: String,
    pub account_name: Option<String>,
    pub security_id: String,
    pub security_symbol: Option<String>,
    pub security_name: Option<String>,
    pub action: String, // "buy" | "sell" | "dividend" | "reinvest" | "split"
    pub tx_date: String, // YYYY-MM-DD
    pub shares_micros: i64, // 1 share = 1_000_000
    pub price_per_share_cents: i64,
    pub commission_cents: i64,
    pub total_amount_cents: i64, // signed: buy outflow is positive cost basis, sell inflow is proceeds
    pub memo: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordInvestmentTxInput {
    pub id: Option<String>,
    pub account_id: String,
    pub security_id: String,
    pub action: String,
    pub tx_date: String,
    pub shares_micros: i64,
    pub price_per_share_cents: i64,
    pub commission_cents: Option<i64>,
    pub total_amount_cents: Option<i64>,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HoldingSummary {
    pub security_id: String,
    pub symbol: String,
    pub name: String,
    pub security_type: String,
    pub total_shares_micros: i64,
    pub total_cost_cents: i64,
    pub avg_cost_per_share_cents: i64,
    pub current_price_cents: i64,
    pub market_value_cents: i64,
    pub unrealized_gain_cents: i64,
    pub unrealized_gain_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSummary {
    pub total_market_value_cents: i64,
    pub total_cost_basis_cents: i64,
    pub total_unrealized_gain_cents: i64,
    pub holdings: Vec<HoldingSummary>,
    pub transactions: Vec<InvestmentTransaction>,
}

// --- Tax Schedule Models ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaxScheduleItem {
    pub schedule_name: String,
    pub category_id: String,
    pub category_name: String,
    pub total_amount_cents: i64,
    pub transaction_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaxYearReport {
    pub year: i32,
    pub total_deductions_cents: i64,
    pub total_taxable_income_cents: i64,
    pub standard_deduction_single_cents: i64,
    pub standard_deduction_married_cents: i64,
    pub schedules: Vec<TaxScheduleItem>,
    pub transactions: Vec<Transaction>,
}

// --- Loan Amortization Models ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AmortizationMonth {
    pub month_index: i32,
    pub date: String,
    pub payment_cents: i64,
    pub principal_cents: i64,
    pub interest_cents: i64,
    pub remaining_balance_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoanCalculation {
    pub principal_cents: i64,
    pub interest_rate_basis_points: i64,
    pub term_months: i32,
    pub monthly_payment_cents: i64,
    pub total_interest_cents: i64,
    pub total_paid_cents: i64,
    pub schedule: Vec<AmortizationMonth>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoanPayoffComparison {
    pub standard_months: i32,
    pub standard_total_interest_cents: i64,
    pub accelerated_months: i32,
    pub accelerated_total_interest_cents: i64,
    pub months_saved: i32,
    pub interest_saved_cents: i64,
}

// --- Multi-Currency Models ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyRate {
    pub code: String, // "USD", "EUR", "GBP", "CAD", "JPY"
    pub name: String,
    pub symbol: String,
    pub rate_to_usd_micros: i64, // e.g. 1 EUR = 1.085000 USD -> 1_085_000
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCurrencyRateInput {
    pub code: String,
    pub name: String,
    pub symbol: String,
    pub rate_to_usd_micros: i64,
}

// --- Advanced Financial Reports Models ---

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FinancialReportFilter {
    pub start_date: Option<String>, // YYYY-MM-DD
    pub end_date: Option<String>,   // YYYY-MM-DD
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayeeSpendingPoint {
    pub payee: String,
    pub transaction_count: i64,
    pub total_spent_cents: i64,
    pub average_spent_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IncomeExpenseReport {
    pub start_date: String,
    pub end_date: String,
    pub total_income_cents: i64,
    pub total_expense_cents: i64,
    pub net_savings_cents: i64,
    pub savings_rate_percent: f64,
    pub category_breakdown: Vec<CategorySpendingPoint>,
    pub top_payees: Vec<PayeeSpendingPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPayload {
    pub accounts: Vec<StoredAccountRecord>,
    pub categories: Vec<Category>,
    pub category_rules: Vec<StoredCategoryRuleRecord>,
    pub transactions: Vec<StoredTransactionRecord>,
    pub budgets: Vec<StoredBudgetRecord>,
    pub recurring_bills: Vec<StoredRecurringBillRecord>,
    #[serde(default)]
    pub transaction_splits: Option<Vec<TransactionSplit>>,
    #[serde(default)]
    pub securities: Option<Vec<Security>>,
    #[serde(default)]
    pub investment_transactions: Option<Vec<InvestmentTransaction>>,
    #[serde(default)]
    pub currency_rates: Option<Vec<CurrencyRate>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupBundle {
    pub app: String,
    pub schema_version: u32,
    pub exported_at: String,
    pub sha256: String,
    pub payload: BackupPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub database_path: String,
    pub database_size_bytes: u64,
    pub account_count: i64,
    pub transaction_count: i64,
    pub category_count: i64,
    pub rule_count: i64,
    pub bill_count: i64,
}
