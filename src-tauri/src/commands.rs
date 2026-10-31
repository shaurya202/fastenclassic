use crate::db::Database;
use crate::models::*;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn get_dashboard_summary(
    db: State<'_, Database>,
    month: String,
    reference_date: String,
) -> Result<DashboardSummary, String> {
    db.get_dashboard_summary(&month, &reference_date)
}

#[tauri::command]
pub fn list_accounts(db: State<'_, Database>) -> Result<Vec<Account>, String> {
    db.list_accounts()
}

#[tauri::command]
pub fn upsert_account(
    db: State<'_, Database>,
    input: UpsertAccountInput,
) -> Result<Account, String> {
    db.upsert_account(&input)
}

#[tauri::command]
pub fn delete_account(db: State<'_, Database>, account_id: String) -> Result<(), String> {
    db.delete_account(&account_id)
}

#[tauri::command]
pub fn list_categories(db: State<'_, Database>) -> Result<Vec<Category>, String> {
    db.list_categories()
}

#[tauri::command]
pub fn upsert_category(
    db: State<'_, Database>,
    input: UpsertCategoryInput,
) -> Result<Category, String> {
    db.upsert_category(&input)
}

#[tauri::command]
pub fn delete_category(db: State<'_, Database>, category_id: String) -> Result<(), String> {
    db.delete_category(&category_id)
}

#[tauri::command]
pub fn list_category_rules(db: State<'_, Database>) -> Result<Vec<CategoryRule>, String> {
    db.list_category_rules()
}

#[tauri::command]
pub fn upsert_category_rule(
    db: State<'_, Database>,
    input: UpsertCategoryRuleInput,
) -> Result<CategoryRule, String> {
    db.upsert_category_rule(&input)
}

#[tauri::command]
pub fn delete_category_rule(db: State<'_, Database>, rule_id: String) -> Result<(), String> {
    db.delete_category_rule(&rule_id)
}

#[tauri::command]
pub fn apply_category_rules(
    db: State<'_, Database>,
    only_uncategorized: bool,
) -> Result<usize, String> {
    db.apply_category_rules(only_uncategorized)
}

#[tauri::command]
pub fn list_transactions(
    db: State<'_, Database>,
    filter: TransactionFilter,
) -> Result<Vec<Transaction>, String> {
    db.list_transactions(&filter)
}

#[tauri::command]
pub fn upsert_transaction(
    db: State<'_, Database>,
    input: UpsertTransactionInput,
) -> Result<Transaction, String> {
    db.upsert_transaction(&input)
}

#[tauri::command]
pub fn assign_transaction_category(
    db: State<'_, Database>,
    transaction_id: String,
    category_id: Option<String>,
    create_rule_pattern: Option<String>,
) -> Result<usize, String> {
    db.assign_transaction_category(&transaction_id, category_id, create_rule_pattern)
}

#[tauri::command]
pub fn delete_transaction(db: State<'_, Database>, transaction_id: String) -> Result<(), String> {
    db.delete_transaction(&transaction_id)
}

#[tauri::command]
pub fn preview_statement_import(
    db: State<'_, Database>,
    request: ImportPreviewRequest,
) -> Result<ImportPreviewResponse, String> {
    db.preview_statement_import(&request)
}

#[tauri::command]
pub fn commit_statement_import(
    db: State<'_, Database>,
    request: CommitImportRequest,
) -> Result<CommitImportResult, String> {
    db.commit_statement_import(&request)
}

#[tauri::command]
pub fn get_month_budget(
    db: State<'_, Database>,
    month: String,
) -> Result<MonthBudgetSummary, String> {
    db.get_month_budget(&month)
}

#[tauri::command]
pub fn set_category_budget(
    db: State<'_, Database>,
    month: String,
    category_id: String,
    limit_cents: i64,
) -> Result<(), String> {
    db.set_category_budget(&month, &category_id, limit_cents)
}

#[tauri::command]
pub fn copy_previous_month_budget(
    db: State<'_, Database>,
    target_month: String,
) -> Result<usize, String> {
    db.copy_previous_month_budget(&target_month)
}

#[tauri::command]
pub fn list_recurring_bills(
    db: State<'_, Database>,
    reference_date: String,
) -> Result<Vec<RecurringBill>, String> {
    db.list_recurring_bills(&reference_date)
}

#[tauri::command]
pub fn upsert_recurring_bill(
    db: State<'_, Database>,
    input: UpsertRecurringBillInput,
    reference_date: String,
) -> Result<RecurringBill, String> {
    db.upsert_recurring_bill(&input, &reference_date)
}

#[tauri::command]
pub fn delete_recurring_bill(db: State<'_, Database>, bill_id: String) -> Result<(), String> {
    db.delete_recurring_bill(&bill_id)
}

#[tauri::command]
pub fn record_bill_payment(
    db: State<'_, Database>,
    bill_id: String,
    paid_date: String,
    account_id_override: Option<String>,
) -> Result<Transaction, String> {
    db.record_bill_payment(&bill_id, &paid_date, account_id_override)
}

#[tauri::command]
pub fn export_backup_json(db: State<'_, Database>) -> Result<String, String> {
    db.export_backup_json()
}

#[tauri::command]
pub fn export_backup_to_file(db: State<'_, Database>, file_path: String) -> Result<(), String> {
    let json = db.export_backup_json()?;
    std::fs::write(PathBuf::from(&file_path), json.as_bytes())
        .map_err(|e| format!("Could not write backup file to '{}': {}", file_path, e))
}

#[tauri::command]
pub fn restore_backup_json(db: State<'_, Database>, raw_json: String) -> Result<(), String> {
    db.restore_backup_json(&raw_json)
}

#[tauri::command]
pub fn restore_backup_from_file(db: State<'_, Database>, file_path: String) -> Result<(), String> {
    let raw = std::fs::read_to_string(PathBuf::from(&file_path))
        .map_err(|e| format!("Could not read backup file '{}': {}", file_path, e))?;
    db.restore_backup_json(&raw)
}

#[tauri::command]
pub fn get_storage_info(db: State<'_, Database>) -> Result<StorageInfo, String> {
    db.get_storage_info()
}

#[tauri::command]
pub fn load_sample_household_data(
    db: State<'_, Database>,
    reference_month: String,
) -> Result<(), String> {
    db.load_sample_household_data(&reference_month)
}

#[tauri::command]
pub fn reset_all_data(db: State<'_, Database>) -> Result<(), String> {
    db.reset_all_data()
}

// --- Investment Commands ---

#[tauri::command]
pub fn list_securities(db: State<'_, Database>) -> Result<Vec<Security>, String> {
    db.list_securities()
}

#[tauri::command]
pub fn upsert_security(
    db: State<'_, Database>,
    input: UpsertSecurityInput,
) -> Result<Security, String> {
    db.upsert_security(&input)
}

#[tauri::command]
pub fn delete_security(db: State<'_, Database>, security_id: String) -> Result<(), String> {
    db.delete_security(&security_id)
}

#[tauri::command]
pub fn record_investment_tx(
    db: State<'_, Database>,
    input: RecordInvestmentTxInput,
) -> Result<InvestmentTransaction, String> {
    db.record_investment_tx(&input)
}

#[tauri::command]
pub fn list_investment_transactions(
    db: State<'_, Database>,
    account_id: Option<String>,
) -> Result<Vec<InvestmentTransaction>, String> {
    db.list_investment_transactions(account_id.as_deref())
}

#[tauri::command]
pub fn get_portfolio_summary(
    db: State<'_, Database>,
    account_id: Option<String>,
) -> Result<PortfolioSummary, String> {
    db.get_portfolio_summary(account_id.as_deref())
}

// --- Tax Schedule Commands ---

#[tauri::command]
pub fn get_tax_schedule_report(
    db: State<'_, Database>,
    year: i32,
) -> Result<TaxYearReport, String> {
    db.get_tax_schedule_report(year)
}

// --- Loan Amortization Commands ---

#[tauri::command]
pub fn calculate_loan_amortization(
    db: State<'_, Database>,
    principal_cents: i64,
    apr_basis_points: i64,
    term_months: i32,
    extra_monthly_cents: Option<i64>,
) -> Result<LoanCalculation, String> {
    db.calculate_loan_amortization(
        principal_cents,
        apr_basis_points,
        term_months,
        extra_monthly_cents.unwrap_or(0),
    )
}

#[tauri::command]
pub fn compare_loan_payoff(
    db: State<'_, Database>,
    principal_cents: i64,
    apr_basis_points: i64,
    term_months: i32,
    extra_monthly_cents: i64,
) -> Result<LoanPayoffComparison, String> {
    db.compare_loan_payoff(
        principal_cents,
        apr_basis_points,
        term_months,
        extra_monthly_cents,
    )
}

// --- Legal Check Words Command ---

#[tauri::command]
pub fn convert_number_to_english_words(
    db: State<'_, Database>,
    amount_cents: i64,
) -> Result<String, String> {
    Ok(db.convert_number_to_english_words(amount_cents))
}

// --- Currency Rates Commands ---

#[tauri::command]
pub fn list_currency_rates(db: State<'_, Database>) -> Result<Vec<CurrencyRate>, String> {
    db.list_currency_rates()
}

#[tauri::command]
pub fn upsert_currency_rate(
    db: State<'_, Database>,
    input: UpsertCurrencyRateInput,
) -> Result<CurrencyRate, String> {
    db.upsert_currency_rate(&input)
}

// --- Advanced Financial Reports Command ---

#[tauri::command]
pub fn get_income_expense_report(
    db: State<'_, Database>,
    filter: FinancialReportFilter,
) -> Result<IncomeExpenseReport, String> {
    db.get_income_expense_report(&filter)
}
