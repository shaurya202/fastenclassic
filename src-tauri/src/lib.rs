pub mod backup;
pub mod commands;
pub mod db;
pub mod dedup;
pub mod models;
pub mod parsers;
pub mod rules;

use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve local app data directory: {}", e))?;
            let db_path = data_dir.join("fastenclassic.sqlite");
            let database = Database::open(&db_path)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_dashboard_summary,
            commands::list_accounts,
            commands::upsert_account,
            commands::delete_account,
            commands::list_categories,
            commands::upsert_category,
            commands::delete_category,
            commands::list_category_rules,
            commands::upsert_category_rule,
            commands::delete_category_rule,
            commands::apply_category_rules,
            commands::list_transactions,
            commands::upsert_transaction,
            commands::assign_transaction_category,
            commands::delete_transaction,
            commands::preview_statement_import,
            commands::commit_statement_import,
            commands::get_month_budget,
            commands::set_category_budget,
            commands::copy_previous_month_budget,
            commands::list_recurring_bills,
            commands::upsert_recurring_bill,
            commands::delete_recurring_bill,
            commands::record_bill_payment,
            commands::export_backup_json,
            commands::export_backup_to_file,
            commands::restore_backup_json,
            commands::restore_backup_from_file,
            commands::get_storage_info,
            commands::load_sample_household_data,
            commands::reset_all_data,
            commands::list_securities,
            commands::upsert_security,
            commands::delete_security,
            commands::record_investment_tx,
            commands::list_investment_transactions,
            commands::get_portfolio_summary,
            commands::get_tax_schedule_report,
            commands::calculate_loan_amortization,
            commands::compare_loan_payoff,
            commands::convert_number_to_english_words,
            commands::list_currency_rates,
            commands::upsert_currency_rate,
            commands::get_income_expense_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fasten Classic desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;

    fn create_test_db_with_checking() -> (Database, Account) {
        let db = Database::open_in_memory().expect("in-memory DB");
        let acc = db
            .upsert_account(&UpsertAccountInput {
                id: None,
                name: "Household Checking".to_string(),
                account_type: "checking".to_string(),
                institution: "Community Credit Union".to_string(),
                opening_balance_cents: 500_000, // $5,000.00
                opening_date: "2026-10-01".to_string(),
                notes: None,
                currency: None,
                interest_rate_basis_points: None,
                term_months: None,
                monthly_payment_cents: None,
            })
            .expect("create account");
        (db, acc)
    }

    #[test]
    fn csv_import_handles_preamble_split_columns_and_same_day_identical_purchases() {
        let (db, acc) = create_test_db_with_checking();
        // Includes bank metadata preamble + two identical $4.50 coffee purchases on the same day!
        let csv_data = "\
Account Name: Household Checking
Statement Period: 10/01/2026 - 10/31/2026

Posting Date,Description,Debit,Credit,Memo
10/05/2026,\"TRADER JOE'S #114\",84.32,,Weekly groceries
10/06/2026,BLUE BOTTLE COFFEE,4.50,,Morning espresso
10/06/2026,BLUE BOTTLE COFFEE,4.50,,Afternoon espresso
10/15/2026,EMPLOYER PAYROLL DIRECT DEP,,3200.00,Biweekly pay
";

        let preview = db
            .preview_statement_import(&ImportPreviewRequest {
                account_id: acc.id.clone(),
                file_name: "checking-oct.csv".to_string(),
                content: csv_data.to_string(),
                format_override: None,
                csv_mapping: None,
            })
            .expect("preview csv");

        assert_eq!(preview.detected_format, "csv");
        assert_eq!(preview.total_rows, 4);
        assert_eq!(preview.new_rows, 4);
        assert_eq!(preview.duplicate_rows, 0);

        // Starter rules should auto-categorize Trader Joe's, Blue Bottle, and Payroll
        assert_eq!(preview.rows[0].payee, "Trader Joe's");
        assert_eq!(preview.rows[0].category_id.as_deref(), Some("cat-groceries"));
        assert_eq!(preview.rows[0].amount_cents, -8_432);
        assert_eq!(preview.rows[3].amount_cents, 320_000);

        // Commit all selected rows
        let commit_rows: Vec<CommitImportRow> = preview
            .rows
            .iter()
            .filter(|r| r.selected)
            .map(|r| CommitImportRow {
                posted_date: r.posted_date.clone(),
                payee: r.payee.clone(),
                original_payee: r.original_payee.clone(),
                memo: r.memo.clone(),
                amount_cents: r.amount_cents,
                category_id: r.category_id.clone(),
                external_id: r.external_id.clone(),
                fingerprint: r.fingerprint.clone(),
            })
            .collect();

        let committed = db
            .commit_statement_import(&CommitImportRequest {
                account_id: acc.id.clone(),
                source_name: "checking-oct.csv".to_string(),
                rows: commit_rows,
            })
            .expect("commit csv");
        assert_eq!(committed.imported_count, 4);
        assert_eq!(committed.skipped_count, 0);

        // Re-importing the exact same CSV must detect all 4 rows (including both $4.50 coffees) as duplicates!
        let repreview = db
            .preview_statement_import(&ImportPreviewRequest {
                account_id: acc.id.clone(),
                file_name: "checking-oct.csv".to_string(),
                content: csv_data.to_string(),
                format_override: None,
                csv_mapping: None,
            })
            .expect("re-preview csv");

        assert_eq!(repreview.duplicate_rows, 4);
        assert_eq!(repreview.new_rows, 0);
        assert!(repreview.rows.iter().all(|r| r.is_duplicate && !r.selected));
    }

    #[test]
    fn ofx_sgml_and_xml_import_extracts_fitid_and_ledger_balance() {
        let (db, acc) = create_test_db_with_checking();
        let ofx_sgml = "\
OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261012120000[-4:EDT]
<TRNAMT>-64.19
<FITID>202610120001
<NAME>WHOLEFDS MKT #102 &amp; CO
<MEMO>Card purchase
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261014
<TRNAMT>-52.00
<FITID>202610140002
<NAME>SHELL OIL 57442
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>4883.81
<DTASOF>20261015
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>";

        let preview = db
            .preview_statement_import(&ImportPreviewRequest {
                account_id: acc.id.clone(),
                file_name: "october.ofx".to_string(),
                content: ofx_sgml.to_string(),
                format_override: None,
                csv_mapping: None,
            })
            .expect("preview ofx");

        assert_eq!(preview.detected_format, "ofx");
        assert_eq!(preview.total_rows, 2);
        assert_eq!(preview.statement_balance_cents, Some(488_381));
        assert_eq!(preview.rows[0].external_id.as_deref(), Some("202610120001"));
        assert_eq!(preview.rows[0].payee, "Whole Foods Market");
        assert_eq!(preview.rows[1].category_id.as_deref(), Some("cat-transport"));
    }

    #[test]
    fn ofx_import_handles_multibyte_unicode_and_special_characters() {
        let (db, acc) = create_test_db_with_checking();
        let ofx_unicode = "\
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:UTF-8
CHARSET:NONE
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261016
<TRNAMT>-32.50
<FITID>202610169999
<NAME>Bäckerei &amp; Café Münsterstraße
<MEMO>Straße und Grüner Markt Großkauf
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>";

        let preview = db
            .preview_statement_import(&ImportPreviewRequest {
                account_id: acc.id.clone(),
                file_name: "unicode_test.ofx".to_string(),
                content: ofx_unicode.to_string(),
                format_override: None,
                csv_mapping: None,
            })
            .expect("preview unicode ofx");

        assert_eq!(preview.detected_format, "ofx");
        assert_eq!(preview.total_rows, 1);
        assert_eq!(preview.rows[0].payee, "Bäckerei & Café Münsterstraße");
        assert_eq!(preview.rows[0].memo, "Straße und Grüner Markt Großkauf");
        assert_eq!(preview.rows[0].amount_cents, -3_250);
    }

    #[test]
    fn qif_import_supports_quicken_apostrophe_dates_and_category_hints() {
        let (db, acc) = create_test_db_with_checking();
        let qif_content = "\
!Type:Bank
D10/18'26
T-128.40
PLocal Farmers Co-op
MFresh produce box
LGroceries
^
D10/20'26
T-45.00
PNeighborhood Hardware
N1042
^
";

        let preview = db
            .preview_statement_import(&ImportPreviewRequest {
                account_id: acc.id.clone(),
                file_name: "export.qif".to_string(),
                content: qif_content.to_string(),
                format_override: None,
                csv_mapping: None,
            })
            .expect("preview qif");

        assert_eq!(preview.detected_format, "qif");
        assert_eq!(preview.total_rows, 2);
        assert_eq!(preview.rows[0].posted_date, "2026-10-18");
        assert_eq!(preview.rows[0].amount_cents, -12_840);
        assert_eq!(preview.rows[0].category_id.as_deref(), Some("cat-groceries"));
        assert!(preview.rows[1].memo.contains("Ref #1042"));
    }

    #[test]
    fn budgets_balances_net_worth_and_recurring_bills_reconcile_exactly() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.load_sample_household_data("2026-10")
            .expect("load sample data");

        let summary = db
            .get_dashboard_summary("2026-10", "2026-10-26")
            .expect("dashboard summary");

        // Verify Net Worth == Assets - Liabilities == SUM(all account current_balance_cents)
        let sum_accounts: i64 = summary.accounts.iter().map(|a| a.current_balance_cents).sum();
        assert_eq!(summary.net_worth_cents, sum_accounts);
        assert_eq!(
            summary.assets_cents - summary.liabilities_cents,
            summary.net_worth_cents
        );

        // Verify each account's balance equals opening_balance_cents + sum(account transactions)
        for acc in &summary.accounts {
            let txs = db
                .list_transactions(&TransactionFilter {
                    account_id: Some(acc.id.clone()),
                    ..Default::default()
                })
                .expect("account txs");
            let tx_sum: i64 = txs.iter().map(|t| t.amount_cents).sum();
            assert_eq!(acc.current_balance_cents, acc.opening_balance_cents + tx_sum);
        }

        // Verify budget totals match underlying October expense category transactions
        let oct_budget = db.get_month_budget("2026-10").expect("oct budget");
        let groceries_row = oct_budget
            .rows
            .iter()
            .find(|r| r.category_id == "cat-groceries")
            .expect("groceries row");
        // Trader Joe's ($156.40) + Costco ($218.50) = $374.90 (37,490 cents)
        assert_eq!(groceries_row.spent_cents, 37_490);
        assert_eq!(groceries_row.budgeted_cents, 65_000);
        assert_eq!(groceries_row.remaining_cents, 27_510);

        // Record a recurring bill payment and confirm due date advances & balance updates
        let electric_bill = summary
            .upcoming_bills
            .iter()
            .find(|b| b.name.contains("Electric"))
            .expect("electric bill")
            .clone();
        let paid_tx = db
            .record_bill_payment(&electric_bill.id, "2026-10-27", None)
            .expect("record bill payment");
        assert_eq!(paid_tx.amount_cents, -14_200);

        let updated_bills = db.list_recurring_bills("2026-10-27").expect("updated bills");
        let updated_electric = updated_bills
            .iter()
            .find(|b| b.id == electric_bill.id)
            .expect("updated electric");
        assert!(updated_electric.next_due_date.starts_with("2026-11-"));
    }

    #[test]
    fn backup_and_restore_roundtrip_preserves_all_data_and_rejects_tampering() {
        let db1 = Database::open_in_memory().expect("db1");
        db1.load_sample_household_data("2026-10").expect("seed");

        // Add a custom category rule and correct the uncategorized hardware transaction
        let uncat = db1
            .list_transactions(&TransactionFilter {
                uncategorized_only: Some(true),
                ..Default::default()
            })
            .expect("uncat");
        assert_eq!(uncat.len(), 1);
        db1.assign_transaction_category(
            &uncat[0].id,
            Some("cat-household".to_string()),
            Some("CORNER HARDWARE".to_string()),
        )
        .expect("assign category + create rule");

        let before_summary = db1
            .get_dashboard_summary("2026-10", "2026-10-26")
            .expect("before summary");
        let backup_json = db1.export_backup_json().expect("export backup");

        // Tampered JSON must fail SHA-256 verification without corrupting target DB
        let tampered = backup_json.replace("Household Checking", "Tampered Checking");
        let db2 = Database::open_in_memory().expect("db2");
        let err = db2
            .restore_backup_json(&tampered)
            .expect_err("tampered backup must be rejected");
        assert!(err.contains("SHA-256"));

        // Valid backup restores identically into clean database
        db2.restore_backup_json(&backup_json)
            .expect("valid backup restore");
        let after_summary = db2
            .get_dashboard_summary("2026-10", "2026-10-26")
            .expect("after summary");

        assert_eq!(before_summary.net_worth_cents, after_summary.net_worth_cents);
        assert_eq!(before_summary.accounts.len(), after_summary.accounts.len());
        assert_eq!(
            before_summary.total_budgeted_cents,
            after_summary.total_budgeted_cents
        );
        assert_eq!(
            before_summary.total_budget_spent_cents,
            after_summary.total_budget_spent_cents
        );
        assert_eq!(after_summary.uncategorized_count, 0);
    }

    #[test]
    fn split_transactions_validate_exact_balance_and_category_allocation() {
        let (db, acc) = create_test_db_with_checking();

        // 1. Mismatched split sum (-$100.00 total vs -$90.00 in splits) must be rejected
        let invalid_res = db.upsert_transaction(&UpsertTransactionInput {
            id: None,
            account_id: acc.id.clone(),
            posted_date: "2026-10-10".to_string(),
            payee: "Target Store".to_string(),
            memo: Some("Mismatched splits".to_string()),
            amount_cents: -10_000, // -$100.00
            category_id: None,
            cleared: Some(true),
            check_number: None,
            splits: Some(vec![
                TransactionSplitInput {
                    id: None,
                    category_id: "cat-groceries".to_string(),
                    amount_cents: -5_000, // -$50.00
                    memo: Some("Food items".to_string()),
                },
                TransactionSplitInput {
                    id: None,
                    category_id: "cat-household".to_string(),
                    amount_cents: -4_000, // -$40.00 (sum is -$90.00 != -$100.00)
                    memo: Some("Cleaning supplies".to_string()),
                },
            ]),
        });
        assert!(invalid_res.is_err(), "Mismatched split sum must return error");

        // 2. Exactly balanced splits (-$100.00 = -$60.00 groceries + -$40.00 household) succeed
        let valid_tx = db.upsert_transaction(&UpsertTransactionInput {
            id: None,
            account_id: acc.id.clone(),
            posted_date: "2026-10-10".to_string(),
            payee: "Target Store".to_string(),
            memo: Some("Balanced splits".to_string()),
            amount_cents: -10_000,
            category_id: None,
            cleared: Some(true),
            check_number: Some("1050".to_string()),
            splits: Some(vec![
                TransactionSplitInput {
                    id: None,
                    category_id: "cat-groceries".to_string(),
                    amount_cents: -6_000,
                    memo: Some("Food items".to_string()),
                },
                TransactionSplitInput {
                    id: None,
                    category_id: "cat-household".to_string(),
                    amount_cents: -4_000,
                    memo: Some("Cleaning supplies".to_string()),
                },
            ]),
        }).expect("valid split transaction");

        assert!(valid_tx.is_split);
        assert_eq!(valid_tx.splits.len(), 2);
        assert_eq!(valid_tx.check_number.as_deref(), Some("1050"));

        // 3. Verify budget reflects split category attribution
        let budget = db.get_month_budget("2026-10").expect("get budget");
        let groc = budget.rows.iter().find(|r| r.category_id == "cat-groceries").expect("groceries");
        let house = budget.rows.iter().find(|r| r.category_id == "cat-household").expect("household");
        assert_eq!(groc.spent_cents, 6_000);
        assert_eq!(house.spent_cents, 4_000);
    }

    #[test]
    fn investment_portfolio_holdings_and_unrealized_gain_loss() {
        let db = Database::open_in_memory().expect("in-memory DB");
        let acc = db.upsert_account(&UpsertAccountInput {
            id: Some("acc-brokerage".to_string()),
            name: "Taxable Brokerage".to_string(),
            account_type: "investment".to_string(),
            institution: "Fidelity".to_string(),
            opening_balance_cents: 10_000_00, // $10,000.00
            opening_date: "2026-01-01".to_string(),
            notes: None,
            currency: Some("USD".to_string()),
            interest_rate_basis_points: None,
            term_months: None,
            monthly_payment_cents: None,
        }).expect("account");

        let sec = db.upsert_security(&UpsertSecurityInput {
            id: None,
            symbol: "VTI".to_string(),
            name: "Vanguard Total Stock Market ETF".to_string(),
            security_type: "etf".to_string(),
            current_price_cents: 28_000, // $280.00
            currency: Some("USD".to_string()),
        }).expect("security");

        // Buy 100 shares @ $220.00 ($22,000 cost basis)
        db.record_investment_tx(&RecordInvestmentTxInput {
            id: None,
            account_id: acc.id.clone(),
            security_id: sec.id.clone(),
            action: "buy".to_string(),
            tx_date: "2026-02-01".to_string(),
            shares_micros: 100_000_000, // 100 shares
            price_per_share_cents: 22_000,
            commission_cents: Some(0),
            total_amount_cents: Some(2_200_000), // $22,000.00
            memo: None,
        }).expect("buy 100");

        // Reinvest dividend 2.5 shares @ $250.00 ($625.00)
        db.record_investment_tx(&RecordInvestmentTxInput {
            id: None,
            account_id: acc.id.clone(),
            security_id: sec.id.clone(),
            action: "reinvest".to_string(),
            tx_date: "2026-05-15".to_string(),
            shares_micros: 2_500_000, // 2.5 shares
            price_per_share_cents: 25_000,
            commission_cents: Some(0),
            total_amount_cents: Some(62_500),
            memo: None,
        }).expect("reinvest");

        let portfolio = db.get_portfolio_summary(Some(&acc.id)).expect("portfolio");
        assert_eq!(portfolio.holdings.len(), 1);
        let h = &portfolio.holdings[0];
        assert_eq!(h.symbol, "VTI");
        assert_eq!(h.total_shares_micros, 102_500_000); // 102.5 shares
        assert_eq!(h.total_cost_cents, 2_262_500); // $22,625.00
        // Current price is $280.00 -> 102.5 * 280 = $28,700.00 (2,870,000 cents)
        assert_eq!(h.market_value_cents, 2_870_000);
        assert_eq!(h.unrealized_gain_cents, 607_500); // +$6,075.00 gain
        assert!(h.unrealized_gain_percent > 26.0 && h.unrealized_gain_percent < 27.0);
    }

    #[test]
    fn tax_schedule_report_groups_deductions_by_schedule() {
        let (db, acc) = create_test_db_with_checking();

        // Medical transaction
        db.upsert_transaction(&UpsertTransactionInput {
            id: None,
            account_id: acc.id.clone(),
            posted_date: "2026-04-12".to_string(),
            payee: "Metro Dental Care".to_string(),
            memo: Some("Dental implants".to_string()),
            amount_cents: -85_000, // -$850.00
            category_id: Some("cat-healthcare".to_string()),
            cleared: Some(true),
            check_number: None,
            splits: None,
        }).expect("dental");

        // Mortgage interest transaction
        db.upsert_transaction(&UpsertTransactionInput {
            id: None,
            account_id: acc.id.clone(),
            posted_date: "2026-05-01".to_string(),
            payee: "Oakridge Mortgage".to_string(),
            memo: Some("Home mortgage payment".to_string()),
            amount_cents: -185_000, // -$1,850.00
            category_id: Some("cat-housing".to_string()),
            cleared: Some(true),
            check_number: None,
            splits: None,
        }).expect("mortgage");

        let tax_report = db.get_tax_schedule_report(2026).expect("tax report");
        assert_eq!(tax_report.year, 2026);
        assert_eq!(tax_report.total_deductions_cents, 270_000); // $850 + $1,850 = $2,700 (270,000 cents)
        assert!(tax_report.schedules.iter().any(|s| s.schedule_name.contains("Schedule A: Medical")));
        assert!(tax_report.schedules.iter().any(|s| s.schedule_name.contains("Schedule A: Home Mortgage Interest")));
    }

    #[test]
    fn loan_amortization_and_accelerated_payoff_math() {
        let db = Database::open_in_memory().expect("in-memory DB");
        // $300,000 principal, 6.00% APR (600 basis points), 360 months (30 years)
        let calc = db.calculate_loan_amortization(30_000_000, 600, 360, 0).expect("amortization");
        // Standard monthly payment for $300k at 6% is ~$1,798.65 (179,865 cents)
        assert!(calc.monthly_payment_cents >= 179_800 && calc.monthly_payment_cents <= 179_900);
        assert_eq!(calc.schedule.len(), 360);
        assert_eq!(calc.schedule.last().unwrap().remaining_balance_cents, 0);

        // Comparison with $200/mo extra payment
        let comp = db.compare_loan_payoff(30_000_000, 600, 360, 20_000).expect("comparison");
        assert!(comp.months_saved > 60); // saves more than 5 years!
        assert!(comp.interest_saved_cents > 7_000_000); // saves >$70,000 in interest!
    }

    #[test]
    fn legal_check_words_conversion() {
        let db = Database::open_in_memory().expect("in-memory DB");
        assert_eq!(
            db.convert_number_to_english_words(142_550),
            "One Thousand Four Hundred Twenty-Five and 50/100 Dollars"
        );
        assert_eq!(
            db.convert_number_to_english_words(500),
            "Five and 00/100 Dollars"
        );
        assert_eq!(
            db.convert_number_to_english_words(25),
            "Zero and 25/100 Dollars"
        );
        assert_eq!(
            db.convert_number_to_english_words(1_000_000_00),
            "One Million and 00/100 Dollars"
        );
    }
}
