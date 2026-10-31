use crate::backup::{create_backup_json, verify_and_parse_backup_json};
use crate::dedup::{compute_base_signature, compute_occurrence_fingerprint};
use crate::models::*;
use crate::parsers::parse_statement;
use crate::rules::{match_category_rule, resolve_category_hint};
use chrono::{Datelike, Duration, Months, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create data directory {}: {}", parent.display(), e))?;
        }
        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open local SQLite database {}: {}", path.display(), e))?;
        let db = Self {
            conn: Mutex::new(conn),
            path: Some(path.to_path_buf()),
        };
        db.init()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory SQLite database: {}", e))?;
        let db = Self {
            conn: Mutex::new(conn),
            path: None,
        };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                account_type TEXT NOT NULL,
                institution TEXT NOT NULL DEFAULT '',
                opening_balance_cents INTEGER NOT NULL DEFAULT 0,
                opening_date TEXT NOT NULL DEFAULT '2026-01-01',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                group_name TEXT NOT NULL,
                kind TEXT NOT NULL,
                color TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS category_rules (
                id TEXT PRIMARY KEY,
                pattern TEXT NOT NULL,
                match_type TEXT NOT NULL DEFAULT 'contains',
                category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                rename_payee TEXT,
                account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
                priority INTEGER NOT NULL DEFAULT 100
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                posted_date TEXT NOT NULL,
                payee TEXT NOT NULL,
                original_payee TEXT NOT NULL,
                memo TEXT NOT NULL DEFAULT '',
                amount_cents INTEGER NOT NULL,
                category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
                external_id TEXT,
                fingerprint TEXT NOT NULL,
                cleared INTEGER NOT NULL DEFAULT 1,
                import_source TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, posted_date DESC);
            CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(posted_date DESC);
            CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(account_id, fingerprint);
            CREATE INDEX IF NOT EXISTS idx_tx_external_id ON transactions(account_id, external_id);

            CREATE TABLE IF NOT EXISTS budgets (
                id TEXT PRIMARY KEY,
                month TEXT NOT NULL,
                category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                limit_cents INTEGER NOT NULL,
                UNIQUE(month, category_id)
            );

            CREATE TABLE IF NOT EXISTS recurring_bills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                payee TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
                account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
                frequency TEXT NOT NULL DEFAULT 'monthly',
                next_due_date TEXT NOT NULL,
                auto_pay INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS transaction_splits (
                id TEXT PRIMARY KEY,
                transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                amount_cents INTEGER NOT NULL,
                memo TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_splits_tx ON transaction_splits(transaction_id);

            CREATE TABLE IF NOT EXISTS securities (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                security_type TEXT NOT NULL DEFAULT 'stock',
                current_price_cents INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS investment_transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                security_id TEXT NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
                action TEXT NOT NULL,
                tx_date TEXT NOT NULL,
                shares_micros INTEGER NOT NULL,
                price_per_share_cents INTEGER NOT NULL,
                commission_cents INTEGER NOT NULL DEFAULT 0,
                total_amount_cents INTEGER NOT NULL,
                memo TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_inv_tx_account ON investment_transactions(account_id, tx_date DESC);
            CREATE INDEX IF NOT EXISTS idx_inv_tx_sec ON investment_transactions(security_id);

            CREATE TABLE IF NOT EXISTS currency_rates (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                rate_to_usd_micros INTEGER NOT NULL DEFAULT 1000000,
                updated_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| format!("Failed to initialize database schema: {}", e))?;

        // Graceful column migrations for existing SQLite databases
        let _ = conn.execute("ALTER TABLE categories ADD COLUMN tax_schedule TEXT", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN interest_rate_basis_points INTEGER", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN term_months INTEGER", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN monthly_payment_cents INTEGER", []);
        let _ = conn.execute("ALTER TABLE transactions ADD COLUMN check_number TEXT", []);

        drop(conn);
        self.seed_defaults_if_empty()?;
        Ok(())
    }

    pub fn seed_defaults_if_empty(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if count > 0 {
            return Ok(());
        }

        let default_categories = [
            ("cat-income-paycheck", "Paycheck & Salary", "Income", "income", "#1B5E4A", None),
            ("cat-income-interest", "Interest Income", "Income", "income", "#2D7A62", Some("1099-INT: Taxable Interest")),
            ("cat-income-dividend", "Dividend Income", "Income", "income", "#2D7A62", Some("1099-DIV: Ordinary Dividends")),
            ("cat-income-other", "Other Income", "Income", "income", "#2D7A62", None),
            ("cat-housing", "Housing & Mortgage", "Essential Living", "expense", "#294C66", Some("Schedule A: Home Mortgage Interest")),
            ("cat-groceries", "Groceries", "Essential Living", "expense", "#2E6F57", None),
            ("cat-utilities", "Utilities & Internet", "Essential Living", "expense", "#3D6582", None),
            ("cat-transport", "Transportation & Fuel", "Essential Living", "expense", "#7A5C2E", None),
            ("cat-healthcare", "Healthcare & Pharmacy", "Essential Living", "expense", "#8E4A49", Some("Schedule A: Medical and Dental")),
            ("cat-insurance", "Insurance", "Essential Living", "expense", "#5A5475", None),
            ("cat-dining", "Dining & Coffee", "Lifestyle", "expense", "#A6631B", None),
            ("cat-household", "Household & Shopping", "Lifestyle", "expense", "#4A6670", None),
            ("cat-charity", "Charitable Donations", "Lifestyle", "expense", "#3A746B", Some("Schedule A: Gifts to Charity")),
            ("cat-taxes", "State & Local Taxes", "Taxes", "expense", "#475569", Some("Schedule A: State and Local Taxes (SALT)")),
            ("cat-subscriptions", "Subscriptions & Media", "Lifestyle", "expense", "#6B5B8E", None),
            ("cat-family", "Family & Recreation", "Lifestyle", "expense", "#3A746B", None),
            ("cat-transfer", "Transfer / Card Payment", "Transfers", "transfer", "#64748B", None),
        ];

        for (id, name, group, kind, color, tax_sched) in default_categories {
            conn.execute(
                "INSERT INTO categories (id, name, group_name, kind, color, tax_schedule) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, name, group, kind, color, tax_sched],
            )
            .map_err(|e| e.to_string())?;
        }

        let default_rates = [
            ("USD", "US Dollar", "$", 1_000_000),
            ("EUR", "Euro", "€", 1_085_000),
            ("GBP", "British Pound", "£", 1_295_000),
            ("CAD", "Canadian Dollar", "C$", 725_000),
            ("JPY", "Japanese Yen", "¥", 6_550),
            ("AUD", "Australian Dollar", "A$", 655_000),
            ("CHF", "Swiss Franc", "CHF", 1_135_000),
        ];
        let now_str = Utc::now().to_rfc3339();
        for (code, name, symbol, rate) in default_rates {
            conn.execute(
                "INSERT OR IGNORE INTO currency_rates (code, name, symbol, rate_to_usd_micros, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![code, name, symbol, rate, now_str],
            )
            .map_err(|e| e.to_string())?;
        }

        let starter_rules = [
            ("rule-payroll", "PAYROLL", "contains", "cat-income-paycheck", Some("Employer Payroll"), 200),
            ("rule-direct-dep", "DIRECT DEP", "contains", "cat-income-paycheck", None, 195),
            ("rule-trader-joes", "TRADER JOE", "contains", "cat-groceries", Some("Trader Joe's"), 150),
            ("rule-whole-foods", "WHOLEFDS", "contains", "cat-groceries", Some("Whole Foods Market"), 150),
            ("rule-whole-foods-2", "WHOLE FOODS", "contains", "cat-groceries", Some("Whole Foods Market"), 150),
            ("rule-kroger", "KROGER", "contains", "cat-groceries", Some("Kroger"), 145),
            ("rule-costco", "COSTCO WHSE", "contains", "cat-groceries", Some("Costco"), 145),
            ("rule-mortgage", "MORTGAGE", "contains", "cat-housing", None, 160),
            ("rule-electric", "ELECTRIC", "contains", "cat-utilities", None, 140),
            ("rule-comcast", "XFINITY", "contains", "cat-utilities", Some("Xfinity Internet"), 140),
            ("rule-shell", "SHELL OIL", "contains", "cat-transport", Some("Shell"), 135),
            ("rule-chevron", "CHEVRON", "contains", "cat-transport", Some("Chevron"), 135),
            ("rule-cvs", "CVS/PHARMACY", "contains", "cat-healthcare", Some("CVS Pharmacy"), 135),
            ("rule-netflix", "NETFLIX", "contains", "cat-subscriptions", Some("Netflix"), 130),
            ("rule-spotify", "SPOTIFY", "contains", "cat-subscriptions", Some("Spotify"), 130),
            ("rule-coffee", "BLUE BOTTLE", "contains", "cat-dining", Some("Blue Bottle Coffee"), 125),
            ("rule-starbucks", "STARBUCKS", "contains", "cat-dining", Some("Starbucks"), 125),
            ("rule-amazon", "AMZN MKTP", "contains", "cat-household", Some("Amazon"), 120),
            ("rule-cc-payment", "CREDIT CARD PMT", "contains", "cat-transfer", None, 180),
            ("rule-autopay-card", "CARD AUTOPAY", "contains", "cat-transfer", None, 180),
        ];

        for (id, pattern, match_type, cat_id, rename, priority) in starter_rules {
            conn.execute(
                "INSERT INTO category_rules (id, pattern, match_type, category_id, rename_payee, priority)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, pattern, match_type, cat_id, rename, priority],
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    // =========================================================================
    // Accounts
    // =========================================================================

    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    a.id,
                    a.name,
                    a.account_type,
                    a.institution,
                    a.opening_balance_cents,
                    a.opening_date,
                    a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS current_balance_cents,
                    COUNT(t.id) AS transaction_count,
                    a.notes,
                    a.created_at,
                    a.currency,
                    a.interest_rate_basis_points,
                    a.term_months,
                    a.monthly_payment_cents
                 FROM accounts a
                 LEFT JOIN transactions t ON t.account_id = a.id
                 GROUP BY a.id
                 ORDER BY a.created_at ASC, a.name ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    account_type: row.get(2)?,
                    institution: row.get(3)?,
                    opening_balance_cents: row.get(4)?,
                    opening_date: row.get(5)?,
                    current_balance_cents: row.get(6)?,
                    transaction_count: row.get(7)?,
                    notes: row.get(8)?,
                    created_at: row.get(9)?,
                    currency: row.get(10)?,
                    interest_rate_basis_points: row.get(11)?,
                    term_months: row.get(12)?,
                    monthly_payment_cents: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn upsert_account(&self, input: &UpsertAccountInput) -> Result<Account, String> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err("Enter an account name (for example, 'Family Checking').".to_string());
        }
        let id = input
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("acc-{}", Uuid::new_v4()));
        let now = Utc::now().to_rfc3339();
        let opening_date = if input.opening_date.trim().is_empty() {
            "2026-01-01".to_string()
        } else {
            input.opening_date.trim().to_string()
        };
        let notes = input.notes.clone().unwrap_or_default();
        let currency = input.currency.clone().unwrap_or_else(|| "USD".to_string());

        {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
                    params![id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;

            if exists {
                conn.execute(
                    "UPDATE accounts
                     SET name = ?2, account_type = ?3, institution = ?4,
                         opening_balance_cents = ?5, opening_date = ?6, notes = ?7,
                         currency = ?8, interest_rate_basis_points = ?9, term_months = ?10,
                         monthly_payment_cents = ?11
                     WHERE id = ?1",
                    params![
                        id,
                        name,
                        input.account_type.trim(),
                        input.institution.trim(),
                        input.opening_balance_cents,
                        opening_date,
                        notes.trim(),
                        currency,
                        input.interest_rate_basis_points,
                        input.term_months,
                        input.monthly_payment_cents
                    ],
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "INSERT INTO accounts (id, name, account_type, institution, opening_balance_cents, opening_date, notes, created_at, currency, interest_rate_basis_points, term_months, monthly_payment_cents)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        id,
                        name,
                        input.account_type.trim(),
                        input.institution.trim(),
                        input.opening_balance_cents,
                        opening_date,
                        notes.trim(),
                        now,
                        currency,
                        input.interest_rate_basis_points,
                        input.term_months,
                        input.monthly_payment_cents
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        self.list_accounts()?
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "Saved account could not be reloaded.".to_string())
    }

    pub fn delete_account(&self, account_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // =========================================================================
    // Categories & Categorization Rules
    // =========================================================================

    pub fn list_categories(&self) -> Result<Vec<Category>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, group_name, kind, color, tax_schedule
                 FROM categories
                 ORDER BY
                    CASE kind WHEN 'income' THEN 0 WHEN 'expense' THEN 1 ELSE 2 END,
                    group_name ASC,
                    name ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Category {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    group_name: r.get(2)?,
                    kind: r.get(3)?,
                    color: r.get(4)?,
                    tax_schedule: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn upsert_category(&self, input: &UpsertCategoryInput) -> Result<Category, String> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err("Category name cannot be blank.".to_string());
        }
        let id = input
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("cat-{}", Uuid::new_v4()));

        let tax_schedule = input
            .tax_schedule
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute(
            "INSERT INTO categories (id, name, group_name, kind, color, tax_schedule)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                group_name = excluded.group_name,
                kind = excluded.kind,
                color = excluded.color,
                tax_schedule = excluded.tax_schedule",
            params![
                id,
                name,
                input.group_name.trim(),
                input.kind.trim(),
                input.color.trim(),
                tax_schedule
            ],
        )
        .map_err(|e| format!("Could not save category '{}': {}", name, e))?;

        Ok(Category {
            id,
            name: name.to_string(),
            group_name: input.group_name.trim().to_string(),
            kind: input.kind.trim().to_string(),
            color: input.color.trim().to_string(),
            tax_schedule,
        })
    }

    pub fn delete_category(&self, category_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute("DELETE FROM categories WHERE id = ?1", params![category_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_category_rules(&self) -> Result<Vec<CategoryRule>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT r.id, r.pattern, r.match_type, r.category_id, c.name, r.rename_payee, r.account_id, r.priority
                 FROM category_rules r
                 LEFT JOIN categories c ON c.id = r.category_id
                 ORDER BY r.priority DESC, r.pattern ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CategoryRule {
                    id: r.get(0)?,
                    pattern: r.get(1)?,
                    match_type: r.get(2)?,
                    category_id: r.get(3)?,
                    category_name: r.get(4)?,
                    rename_payee: r.get(5)?,
                    account_id: r.get(6)?,
                    priority: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn upsert_category_rule(&self, input: &UpsertCategoryRuleInput) -> Result<CategoryRule, String> {
        let pattern = input.pattern.trim();
        if pattern.is_empty() {
            return Err("Rule match text cannot be blank.".to_string());
        }
        let id = input
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("rule-{}", Uuid::new_v4()));
        let rename_clean = input
            .rename_payee
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let account_clean = input
            .account_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            conn.execute(
                "INSERT INTO category_rules (id, pattern, match_type, category_id, rename_payee, account_id, priority)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    pattern = excluded.pattern,
                    match_type = excluded.match_type,
                    category_id = excluded.category_id,
                    rename_payee = excluded.rename_payee,
                    account_id = excluded.account_id,
                    priority = excluded.priority",
                params![
                    id,
                    pattern,
                    input.match_type.trim(),
                    input.category_id.trim(),
                    rename_clean,
                    account_clean,
                    input.priority
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        self.list_category_rules()?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| "Saved rule could not be reloaded.".to_string())
    }

    pub fn delete_category_rule(&self, rule_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute("DELETE FROM category_rules WHERE id = ?1", params![rule_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn apply_category_rules(&self, only_uncategorized: bool) -> Result<usize, String> {
        let rules = self.list_category_rules()?;
        if rules.is_empty() {
            return Ok(0);
        }

        let mut conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let sql = if only_uncategorized {
            "SELECT id, account_id, payee, original_payee, memo FROM transactions WHERE category_id IS NULL"
        } else {
            "SELECT id, account_id, payee, original_payee, memo FROM transactions"
        };

        let candidates: Vec<(String, String, String, String, String)> = {
            let mut stmt = tx.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let mut updated = 0usize;
        for (id, acc_id, payee, orig_payee, memo) in candidates {
            let match_source = if orig_payee.trim().is_empty() {
                &payee
            } else {
                &orig_payee
            };
            if let Some(m) = match_category_rule(&rules, match_source, &memo, &acc_id)
                .or_else(|| match_category_rule(&rules, &payee, &memo, &acc_id))
            {
                let next_payee = m.renamed_payee.unwrap_or(payee);
                tx.execute(
                    "UPDATE transactions SET category_id = ?2, payee = ?3 WHERE id = ?1",
                    params![id, m.category_id, next_payee],
                )
                .map_err(|e| e.to_string())?;
                updated += 1;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated)
    }

    // =========================================================================
    // Transactions
    // =========================================================================

    pub fn list_transactions(&self, filter: &TransactionFilter) -> Result<Vec<Transaction>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;

        let mut splits_by_tx: HashMap<String, Vec<TransactionSplit>> = HashMap::new();
        {
            let mut s_stmt = conn
                .prepare(
                    "SELECT s.id, s.transaction_id, s.category_id, c.name, c.color, s.amount_cents, s.memo
                     FROM transaction_splits s
                     LEFT JOIN categories c ON c.id = s.category_id
                     ORDER BY s.id ASC",
                )
                .map_err(|e| e.to_string())?;
            let s_rows = s_stmt
                .query_map([], |r| {
                    Ok(TransactionSplit {
                        id: r.get(0)?,
                        transaction_id: r.get(1)?,
                        category_id: r.get(2)?,
                        category_name: r.get(3)?,
                        category_color: r.get(4)?,
                        amount_cents: r.get(5)?,
                        memo: r.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for s in s_rows {
                if let Ok(split) = s {
                    splits_by_tx
                        .entry(split.transaction_id.clone())
                        .or_default()
                        .push(split);
                }
            }
        }

        let mut stmt = conn
            .prepare(
                "SELECT
                    t.id,
                    t.account_id,
                    a.name,
                    t.posted_date,
                    t.payee,
                    t.original_payee,
                    t.memo,
                    t.amount_cents,
                    t.category_id,
                    c.name,
                    c.kind,
                    c.color,
                    t.external_id,
                    t.fingerprint,
                    t.cleared,
                    t.import_source,
                    t.created_at,
                    t.check_number
                 FROM transactions t
                 LEFT JOIN accounts a ON a.id = t.account_id
                 LEFT JOIN categories c ON c.id = t.category_id
                 ORDER BY t.posted_date DESC, t.created_at DESC, t.id DESC",
            )
            .map_err(|e| e.to_string())?;

        let all = stmt
            .query_map([], |r| {
                let cleared_int: i64 = r.get(14)?;
                let tx_id: String = r.get(0)?;
                let splits = splits_by_tx.remove(&tx_id).unwrap_or_default();
                let is_split = !splits.is_empty();

                Ok(Transaction {
                    id: tx_id,
                    account_id: r.get(1)?,
                    account_name: r.get(2)?,
                    posted_date: r.get(3)?,
                    payee: r.get(4)?,
                    original_payee: r.get(5)?,
                    memo: r.get(6)?,
                    amount_cents: r.get(7)?,
                    category_id: r.get(8)?,
                    category_name: r.get(9)?,
                    category_kind: r.get(10)?,
                    category_color: r.get(11)?,
                    external_id: r.get(12)?,
                    fingerprint: r.get(13)?,
                    cleared: cleared_int != 0,
                    check_number: r.get(17)?,
                    is_split,
                    splits,
                    import_source: r.get(15)?,
                    created_at: r.get(16)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let search_q = filter
            .search
            .as_ref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());

        let filtered = all
            .into_iter()
            .filter(|tx| {
                if let Some(ref acc) = filter.account_id {
                    if !acc.is_empty() && &tx.account_id != acc {
                        return false;
                    }
                }
                if let Some(ref cat) = filter.category_id {
                    if !cat.is_empty() {
                        let has_split_cat = tx.splits.iter().any(|s| &s.category_id == cat);
                        if tx.category_id.as_deref() != Some(cat.as_str()) && !has_split_cat {
                            return false;
                        }
                    }
                }
                if filter.uncategorized_only.unwrap_or(false) && (tx.category_id.is_some() || tx.is_split) {
                    return false;
                }
                if let Some(ref m) = filter.month {
                    if !m.is_empty() && !tx.posted_date.starts_with(m.as_str()) {
                        return false;
                    }
                }
                if let Some(ref q) = search_q {
                    let hay = format!(
                        "{} {} {} {} {}",
                        tx.payee.to_lowercase(),
                        tx.original_payee.to_lowercase(),
                        tx.memo.to_lowercase(),
                        tx.category_name.as_deref().unwrap_or("").to_lowercase(),
                        tx.check_number.as_deref().unwrap_or("").to_lowercase()
                    );
                    if !hay.contains(q) {
                        return false;
                    }
                }
                true
            })
            .collect();

        Ok(filtered)
    }

    pub fn upsert_transaction(&self, input: &UpsertTransactionInput) -> Result<Transaction, String> {
        let payee = input.payee.trim();
        if payee.is_empty() {
            return Err("Enter a payee or description for this transaction.".to_string());
        }
        let posted_date = crate::parsers::parse_flexible_date(&input.posted_date)?;
        let memo = input.memo.clone().unwrap_or_default().trim().to_string();
        let cat_id = input
            .category_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let cleared = if input.cleared.unwrap_or(true) { 1 } else { 0 };
        let check_num = input
            .check_number
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let now = Utc::now().to_rfc3339();

        let has_splits = if let Some(ref splits) = input.splits {
            if !splits.is_empty() {
                let sum: i64 = splits.iter().map(|s| s.amount_cents).sum();
                if sum != input.amount_cents {
                    return Err(format!(
                        "Split items total (${:.2}) does not equal transaction total (${:.2}).",
                        sum as f64 / 100.0,
                        input.amount_cents as f64 / 100.0
                    ));
                }
                true
            } else {
                false
            }
        } else {
            false
        };

        let id = input
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("tx-{}", Uuid::new_v4()));

        {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            let existing: Option<(String, String)> = conn
                .query_row(
                    "SELECT original_payee, fingerprint FROM transactions WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if let Some((orig_payee, fp)) = existing {
                conn.execute(
                    "UPDATE transactions
                     SET account_id = ?2, posted_date = ?3, payee = ?4, memo = ?5,
                         amount_cents = ?6, category_id = ?7, cleared = ?8,
                         original_payee = ?9, fingerprint = ?10, check_number = ?11
                     WHERE id = ?1",
                    params![
                        id,
                        input.account_id,
                        posted_date,
                        payee,
                        memo,
                        input.amount_cents,
                        if has_splits { None } else { cat_id },
                        cleared,
                        orig_payee,
                        fp,
                        check_num
                    ],
                )
                .map_err(|e| e.to_string())?;
            } else {
                // Determine occurrence count for manual entry fingerprint
                let base_sig = compute_base_signature(
                    &input.account_id,
                    &posted_date,
                    input.amount_cents,
                    payee,
                );
                let like_pattern = format!("{}#%", base_sig);
                let existing_count: usize = conn
                    .query_row(
                        "SELECT COUNT(*) FROM transactions WHERE account_id = ?1 AND fingerprint LIKE ?2",
                        params![input.account_id, like_pattern],
                        |r| r.get::<_, i64>(0),
                    )
                    .map_err(|e| e.to_string())? as usize;
                let fp = compute_occurrence_fingerprint(
                    &input.account_id,
                    &posted_date,
                    input.amount_cents,
                    payee,
                    existing_count + 1,
                );

                conn.execute(
                    "INSERT INTO transactions (
                        id, account_id, posted_date, payee, original_payee, memo,
                        amount_cents, category_id, external_id, fingerprint, cleared, import_source, created_at, check_number
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, 'manual', ?11, ?12)",
                    params![
                        id,
                        input.account_id,
                        posted_date,
                        payee,
                        payee,
                        memo,
                        input.amount_cents,
                        if has_splits { None } else { cat_id },
                        fp,
                        cleared,
                        now,
                        check_num
                    ],
                )
                .map_err(|e| e.to_string())?;
            }

            // Sync splits table
            if let Some(ref splits) = input.splits {
                conn.execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![id])
                    .map_err(|e| e.to_string())?;
                for s in splits {
                    let s_id = s.id.clone().filter(|x| !x.trim().is_empty()).unwrap_or_else(|| format!("split-{}", Uuid::new_v4()));
                    conn.execute(
                        "INSERT INTO transaction_splits (id, transaction_id, category_id, amount_cents, memo)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            s_id,
                            id,
                            s.category_id,
                            s.amount_cents,
                            s.memo.clone().unwrap_or_default().trim()
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }

        self.list_transactions(&TransactionFilter::default())?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| "Saved transaction could not be reloaded.".to_string())
    }

    pub fn assign_transaction_category(
        &self,
        transaction_id: &str,
        category_id: Option<String>,
        create_rule_pattern: Option<String>,
    ) -> Result<usize, String> {
        let cat_clean = category_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            conn.execute(
                "UPDATE transactions SET category_id = ?2 WHERE id = ?1",
                params![transaction_id, cat_clean],
            )
            .map_err(|e| e.to_string())?;
        }

        let mut rule_applied_count = 0usize;
        if let (Some(cat_id), Some(pattern)) = (cat_clean, create_rule_pattern) {
            let trimmed_pat = pattern.trim();
            if !trimmed_pat.is_empty() {
                self.upsert_category_rule(&UpsertCategoryRuleInput {
                    id: None,
                    pattern: trimmed_pat.to_string(),
                    match_type: "contains".to_string(),
                    category_id: cat_id,
                    rename_payee: None,
                    account_id: None,
                    priority: 170,
                })?;
                rule_applied_count = self.apply_category_rules(true)?;
            }
        }
        Ok(rule_applied_count)
    }

    pub fn delete_transaction(&self, transaction_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute("DELETE FROM transactions WHERE id = ?1", params![transaction_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // =========================================================================
    // Statement Import Preview & Commit (CSV / OFX / QIF)
    // =========================================================================

    pub fn preview_statement_import(
        &self,
        req: &ImportPreviewRequest,
    ) -> Result<ImportPreviewResponse, String> {
        if req.account_id.trim().is_empty() {
            return Err("Select an account to import this statement into.".to_string());
        }

        let parsed = parse_statement(
            &req.file_name,
            &req.content,
            req.format_override.as_deref(),
            req.csv_mapping.as_ref(),
        )?;

        let rules = self.list_category_rules()?;
        let categories = self.list_categories()?;
        let category_names: HashMap<String, String> = categories
            .iter()
            .map(|c| (c.id.clone(), c.name.clone()))
            .collect();

        let (existing_ext_ids, existing_fingerprints): (HashSet<String>, HashSet<String>) = {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            let mut ext_set = HashSet::new();
            let mut fp_set = HashSet::new();
            let mut stmt = conn
                .prepare("SELECT external_id, fingerprint FROM transactions WHERE account_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![req.account_id], |r| {
                    Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (ext, fp) = row.map_err(|e| e.to_string())?;
                if let Some(e_id) = ext {
                    if !e_id.is_empty() {
                        ext_set.insert(e_id);
                    }
                }
                fp_set.insert(fp);
            }
            (ext_set, fp_set)
        };

        let mut seen_ext_in_file: HashSet<String> = HashSet::new();
        let mut occurrence_counter: HashMap<String, usize> = HashMap::new();
        let mut preview_rows = Vec::with_capacity(parsed.rows.len());
        let mut duplicate_rows = 0usize;

        for (idx, r) in parsed.rows.into_iter().enumerate() {
            let base_sig = compute_base_signature(
                &req.account_id,
                &r.posted_date,
                r.amount_cents,
                &r.payee,
            );
            let occ = {
                let entry = occurrence_counter.entry(base_sig).or_insert(0);
                *entry += 1;
                *entry
            };
            let fingerprint = compute_occurrence_fingerprint(
                &req.account_id,
                &r.posted_date,
                r.amount_cents,
                &r.payee,
                occ,
            );

            let mut is_duplicate = false;
            let mut duplicate_reason = None;

            if let Some(ref ext_id) = r.external_id {
                if existing_ext_ids.contains(ext_id) {
                    is_duplicate = true;
                    duplicate_reason = Some(format!("Already imported (bank ID {})", ext_id));
                } else if !seen_ext_in_file.insert(ext_id.clone()) {
                    is_duplicate = true;
                    duplicate_reason = Some(format!("Duplicate bank ID {} within statement", ext_id));
                }
            }

            if !is_duplicate && existing_fingerprints.contains(&fingerprint) {
                is_duplicate = true;
                duplicate_reason = Some(format!(
                    "Matches existing transaction on {}",
                    r.posted_date
                ));
            }

            if is_duplicate {
                duplicate_rows += 1;
            }

            // Apply categorization rules (or QIF category hint if no rule matches)
            let rule_match = match_category_rule(&rules, &r.payee, &r.memo, &req.account_id);
            let (display_payee, category_id, matched_rule_id) = if let Some(m) = rule_match {
                (
                    m.renamed_payee.unwrap_or_else(|| r.payee.clone()),
                    Some(m.category_id),
                    Some(m.rule_id),
                )
            } else {
                let hinted = r
                    .category_hint
                    .as_deref()
                    .and_then(|h| resolve_category_hint(&categories, h));
                (r.payee.clone(), hinted, None)
            };

            let category_name = category_id
                .as_ref()
                .and_then(|cid| category_names.get(cid).cloned());

            preview_rows.push(ImportPreviewRow {
                row_index: idx,
                posted_date: r.posted_date,
                payee: display_payee,
                original_payee: r.payee,
                memo: r.memo,
                amount_cents: r.amount_cents,
                category_id,
                category_name,
                matched_rule_id,
                external_id: r.external_id,
                fingerprint,
                is_duplicate,
                duplicate_reason,
                selected: !is_duplicate,
            });
        }

        let total_rows = preview_rows.len();
        let new_rows = total_rows.saturating_sub(duplicate_rows);

        Ok(ImportPreviewResponse {
            detected_format: parsed.format,
            total_rows,
            new_rows,
            duplicate_rows,
            statement_balance_cents: parsed.statement_balance_cents,
            csv_headers: parsed.csv_headers,
            inferred_csv_mapping: parsed.inferred_csv_mapping,
            warnings: parsed.warnings,
            rows: preview_rows,
        })
    }

    pub fn commit_statement_import(
        &self,
        req: &CommitImportRequest,
    ) -> Result<CommitImportResult, String> {
        let mut conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let now = Utc::now().to_rfc3339();
        let mut imported_count = 0usize;
        let mut skipped_count = 0usize;

        for row in &req.rows {
            // Guard against silent duplication even if commit is invoked twice
            if let Some(ref ext_id) = row.external_id {
                if !ext_id.is_empty() {
                    let exists: bool = tx
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM transactions WHERE account_id = ?1 AND external_id = ?2)",
                            params![req.account_id, ext_id],
                            |r| r.get(0),
                        )
                        .map_err(|e| e.to_string())?;
                    if exists {
                        skipped_count += 1;
                        continue;
                    }
                }
            }

            let fp_exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM transactions WHERE account_id = ?1 AND fingerprint = ?2)",
                    params![req.account_id, row.fingerprint],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if fp_exists {
                skipped_count += 1;
                continue;
            }

            let id = format!("tx-{}", Uuid::new_v4());
            let cat_clean = row
                .category_id
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            tx.execute(
                "INSERT INTO transactions (
                    id, account_id, posted_date, payee, original_payee, memo,
                    amount_cents, category_id, external_id, fingerprint, cleared, import_source, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12)",
                params![
                    id,
                    req.account_id,
                    row.posted_date,
                    row.payee.trim(),
                    row.original_payee.trim(),
                    row.memo.trim(),
                    row.amount_cents,
                    cat_clean,
                    row.external_id,
                    row.fingerprint,
                    req.source_name,
                    now
                ],
            )
            .map_err(|e| e.to_string())?;

            imported_count += 1;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(CommitImportResult {
            imported_count,
            skipped_count,
        })
    }

    // =========================================================================
    // Monthly Budgets
    // =========================================================================

    pub fn get_month_budget(&self, month: &str) -> Result<MonthBudgetSummary, String> {
        let categories = self.list_categories()?;
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;

        let mut budget_map: HashMap<String, i64> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT category_id, limit_cents FROM budgets WHERE month = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![month], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                .map_err(|e| e.to_string())?;
            for r in rows {
                let (cid, lim) = r.map_err(|e| e.to_string())?;
                budget_map.insert(cid, lim);
            }
        }

        let month_prefix = format!("{}%", month);
        let mut net_by_cat: HashMap<String, i64> = HashMap::new();
        let mut income_cents = 0i64;
        {
            let mut stmt = conn
                .prepare(
                    "SELECT
                        COALESCE(s.category_id, t.category_id),
                        COALESCE(s.amount_cents, t.amount_cents),
                        c.kind
                     FROM transactions t
                     LEFT JOIN transaction_splits s ON s.transaction_id = t.id
                     LEFT JOIN categories c ON c.id = COALESCE(s.category_id, t.category_id)
                     WHERE t.posted_date LIKE ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![month_prefix], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for r in rows {
                let (cid_opt, amt, kind_opt) = r.map_err(|e| e.to_string())?;
                let kind = kind_opt.as_deref().unwrap_or("expense");
                if kind == "transfer" {
                    continue;
                }
                if kind == "income" || (cid_opt.is_none() && amt > 0) {
                    income_cents += amt;
                }
                if let Some(cid) = cid_opt {
                    *net_by_cat.entry(cid).or_insert(0) += amt;
                }
            }
        }

        let mut rows = Vec::new();
        let mut total_budgeted_cents = 0i64;
        let mut total_spent_cents = 0i64;

        for cat in categories.into_iter().filter(|c| c.kind == "expense") {
            let budgeted = *budget_map.get(&cat.id).unwrap_or(&0);
            let net_signed = *net_by_cat.get(&cat.id).unwrap_or(&0);
            // Expenses are negative in ledger; refunds in an expense category offset spending
            let spent = (-net_signed).max(0);
            let remaining = budgeted - spent;

            total_budgeted_cents += budgeted;
            total_spent_cents += spent;

            rows.push(BudgetRow {
                category_id: cat.id,
                category_name: cat.name,
                group_name: cat.group_name,
                color: cat.color,
                month: month.to_string(),
                budgeted_cents: budgeted,
                spent_cents: spent,
                remaining_cents: remaining,
            });
        }

        Ok(MonthBudgetSummary {
            month: month.to_string(),
            total_budgeted_cents,
            total_spent_cents,
            total_remaining_cents: total_budgeted_cents - total_spent_cents,
            income_cents,
            rows,
        })
    }

    pub fn set_category_budget(
        &self,
        month: &str,
        category_id: &str,
        limit_cents: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        if limit_cents <= 0 {
            conn.execute(
                "DELETE FROM budgets WHERE month = ?1 AND category_id = ?2",
                params![month, category_id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            let id = format!("bgt-{}-{}", month, category_id);
            conn.execute(
                "INSERT INTO budgets (id, month, category_id, limit_cents)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(month, category_id) DO UPDATE SET limit_cents = excluded.limit_cents",
                params![id, month, category_id, limit_cents],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn copy_previous_month_budget(&self, target_month: &str) -> Result<usize, String> {
        let first_day = NaiveDate::parse_from_str(&format!("{}-01", target_month), "%Y-%m-%d")
            .map_err(|_| format!("Invalid month '{}'. Expected YYYY-MM.", target_month))?;
        let prev_day = first_day
            .checked_sub_months(Months::new(1))
            .ok_or_else(|| "Could not compute previous month.".to_string())?;
        let prev_month = prev_day.format("%Y-%m").to_string();

        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let prev_items: Vec<(String, i64)> = {
            let mut stmt = conn
                .prepare("SELECT category_id, limit_cents FROM budgets WHERE month = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![prev_month], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let mut copied = 0usize;
        for (cat_id, lim) in prev_items {
            let id = format!("bgt-{}-{}", target_month, cat_id);
            conn.execute(
                "INSERT INTO budgets (id, month, category_id, limit_cents)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(month, category_id) DO UPDATE SET limit_cents = excluded.limit_cents",
                params![id, target_month, cat_id, lim],
            )
            .map_err(|e| e.to_string())?;
            copied += 1;
        }
        Ok(copied)
    }

    // =========================================================================
    // Recurring Bills & Reminders
    // =========================================================================

    pub fn list_recurring_bills(&self, reference_date: &str) -> Result<Vec<RecurringBill>, String> {
        let ref_dt = NaiveDate::parse_from_str(reference_date, "%Y-%m-%d")
            .unwrap_or_else(|_| Utc::now().date_naive());

        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    b.id, b.name, b.payee, b.amount_cents,
                    b.category_id, c.name,
                    b.account_id, a.name,
                    b.frequency, b.next_due_date, b.auto_pay, b.notes, b.active
                 FROM recurring_bills b
                 LEFT JOIN categories c ON c.id = b.category_id
                 LEFT JOIN accounts a ON a.id = b.account_id
                 ORDER BY b.active DESC, b.next_due_date ASC, b.name ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                let next_due: String = r.get(9)?;
                let auto_int: i64 = r.get(10)?;
                let active_int: i64 = r.get(12)?;
                let active = active_int != 0;
                let due_dt = NaiveDate::parse_from_str(&next_due, "%Y-%m-%d").unwrap_or(ref_dt);
                let days_until_due = (due_dt - ref_dt).num_days();
                let status = if !active {
                    "paused"
                } else if days_until_due < 0 {
                    "overdue"
                } else if days_until_due <= 7 {
                    "due_soon"
                } else {
                    "upcoming"
                };

                Ok(RecurringBill {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    payee: r.get(2)?,
                    amount_cents: r.get(3)?,
                    category_id: r.get(4)?,
                    category_name: r.get(5)?,
                    account_id: r.get(6)?,
                    account_name: r.get(7)?,
                    frequency: r.get(8)?,
                    next_due_date: next_due,
                    auto_pay: auto_int != 0,
                    notes: r.get(11)?,
                    active,
                    days_until_due,
                    status: status.to_string(),
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn upsert_recurring_bill(
        &self,
        input: &UpsertRecurringBillInput,
        reference_date: &str,
    ) -> Result<RecurringBill, String> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err("Enter a bill name (for example, 'Electric Bill').".to_string());
        }
        let payee = if input.payee.trim().is_empty() {
            name
        } else {
            input.payee.trim()
        };
        let next_due = crate::parsers::parse_flexible_date(&input.next_due_date)?;
        let id = input
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("bill-{}", Uuid::new_v4()));
        let cat_clean = input
            .category_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let acc_clean = input
            .account_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            conn.execute(
                "INSERT INTO recurring_bills (
                    id, name, payee, amount_cents, category_id, account_id,
                    frequency, next_due_date, auto_pay, notes, active
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    payee = excluded.payee,
                    amount_cents = excluded.amount_cents,
                    category_id = excluded.category_id,
                    account_id = excluded.account_id,
                    frequency = excluded.frequency,
                    next_due_date = excluded.next_due_date,
                    auto_pay = excluded.auto_pay,
                    notes = excluded.notes,
                    active = excluded.active",
                params![
                    id,
                    name,
                    payee,
                    input.amount_cents.abs(),
                    cat_clean,
                    acc_clean,
                    input.frequency.trim(),
                    next_due,
                    if input.auto_pay { 1 } else { 0 },
                    input.notes.as_deref().unwrap_or("").trim(),
                    if input.active.unwrap_or(true) { 1 } else { 0 }
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        self.list_recurring_bills(reference_date)?
            .into_iter()
            .find(|b| b.id == id)
            .ok_or_else(|| "Saved bill could not be reloaded.".to_string())
    }

    pub fn delete_recurring_bill(&self, bill_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute("DELETE FROM recurring_bills WHERE id = ?1", params![bill_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn record_bill_payment(
        &self,
        bill_id: &str,
        paid_date: &str,
        account_id_override: Option<String>,
    ) -> Result<Transaction, String> {
        let bills = self.list_recurring_bills(paid_date)?;
        let bill = bills
            .into_iter()
            .find(|b| b.id == bill_id)
            .ok_or_else(|| "Could not find that recurring bill.".to_string())?;

        let target_account = account_id_override
            .filter(|s| !s.trim().is_empty())
            .or(bill.account_id.clone())
            .or_else(|| {
                self.list_accounts()
                    .ok()
                    .and_then(|accs| accs.into_iter().next().map(|a| a.id))
            })
            .ok_or_else(|| "Create at least one account before recording a bill payment.".to_string())?;

        let tx = self.upsert_transaction(&UpsertTransactionInput {
            id: None,
            account_id: target_account,
            posted_date: paid_date.to_string(),
            payee: bill.payee.clone(),
            memo: Some(format!("Recurring bill: {}", bill.name)),
            amount_cents: -(bill.amount_cents.abs()),
            category_id: bill.category_id.clone(),
            cleared: Some(true),
            check_number: None,
            splits: None,
        })?;

        // Advance next_due_date by 1 billing cycle
        let current_due = NaiveDate::parse_from_str(&bill.next_due_date, "%Y-%m-%d")
            .map_err(|e| e.to_string())?;
        let advanced = match bill.frequency.as_str() {
            "biweekly" => current_due + Duration::days(14),
            "quarterly" => current_due
                .checked_add_months(Months::new(3))
                .unwrap_or(current_due + Duration::days(91)),
            "yearly" => current_due
                .checked_add_months(Months::new(12))
                .unwrap_or(current_due + Duration::days(365)),
            _ => current_due
                .checked_add_months(Months::new(1))
                .unwrap_or(current_due + Duration::days(30)),
        };

        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute(
            "UPDATE recurring_bills SET next_due_date = ?2 WHERE id = ?1",
            params![bill.id, advanced.format("%Y-%m-%d").to_string()],
        )
        .map_err(|e| e.to_string())?;

        Ok(tx)
    }

    // =========================================================================
    // Dashboard, Spending Trends & Net Worth
    // =========================================================================

    pub fn get_dashboard_summary(
        &self,
        month: &str,
        reference_date: &str,
    ) -> Result<DashboardSummary, String> {
        let accounts = self.list_accounts()?;
        let mut assets_cents = 0i64;
        let mut liabilities_cents = 0i64;
        let mut net_worth_cents = 0i64;

        for acc in &accounts {
            net_worth_cents += acc.current_balance_cents;
            if acc.current_balance_cents >= 0 {
                assets_cents += acc.current_balance_cents;
            } else {
                liabilities_cents += acc.current_balance_cents.abs();
            }
        }

        let budget_summary = self.get_month_budget(month)?;
        let upcoming_bills: Vec<RecurringBill> = self
            .list_recurring_bills(reference_date)?
            .into_iter()
            .filter(|b| b.active)
            .collect();

        // Compute month income, month expenses, category spending, and 6-month trend
        let anchor = NaiveDate::parse_from_str(&format!("{}-01", month), "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2026, 10, 1).unwrap());

        let mut trend_months = Vec::with_capacity(6);
        for back in (0..6).rev() {
            let dt = anchor
                .checked_sub_months(Months::new(back))
                .unwrap_or(anchor);
            trend_months.push((
                dt.format("%Y-%m").to_string(),
                dt.format("%b %Y").to_string(),
            ));
        }

        let all_txs = self.list_transactions(&TransactionFilter::default())?;
        let uncategorized_count = all_txs.iter().filter(|t| t.category_id.is_none() && !t.is_split).count() as i64;

        let mut month_income_cents = 0i64;
        let mut month_expense_cents = 0i64;
        let mut cat_spend: HashMap<String, (String, String, i64, i64)> = HashMap::new(); // id -> (name, color, net_signed, count)
        let mut trend_accum: HashMap<String, (i64, i64)> = HashMap::new();

        for tx in &all_txs {
            let kind = tx.category_kind.as_deref().unwrap_or("expense");
            if kind == "transfer" {
                continue;
            }
            let ym = if tx.posted_date.len() >= 7 {
                &tx.posted_date[..7]
            } else {
                ""
            };

            if let Some(entry) = trend_accum.get_mut(ym) {
                if tx.amount_cents > 0 {
                    entry.0 += tx.amount_cents;
                } else {
                    entry.1 += tx.amount_cents.abs();
                }
            } else if trend_months.iter().any(|(m, _)| m == ym) {
                let inc = if tx.amount_cents > 0 { tx.amount_cents } else { 0 };
                let exp = if tx.amount_cents < 0 { tx.amount_cents.abs() } else { 0 };
                trend_accum.insert(ym.to_string(), (inc, exp));
            }

            if ym == month {
                if tx.amount_cents > 0 && (kind == "income" || tx.category_id.is_none()) {
                    month_income_cents += tx.amount_cents;
                } else if tx.amount_cents < 0 {
                    month_expense_cents += tx.amount_cents.abs();
                } else if kind == "expense" && tx.amount_cents > 0 {
                    // Refund in an expense category reduces monthly expense
                    month_expense_cents = (month_expense_cents - tx.amount_cents).max(0);
                }

                if tx.is_split && !tx.splits.is_empty() {
                    for s in &tx.splits {
                        let cid = s.category_id.clone();
                        let cname = s.category_name.clone().unwrap_or_else(|| "Split Category".to_string());
                        let ccolor = s.category_color.clone().unwrap_or_else(|| "#4A6670".to_string());
                        let item = cat_spend.entry(cid).or_insert((cname, ccolor, 0, 0));
                        item.2 += s.amount_cents;
                        item.3 += 1;
                    }
                } else if kind != "income" {
                    let cid = tx
                        .category_id
                        .clone()
                        .unwrap_or_else(|| "uncategorized".to_string());
                    let cname = tx
                        .category_name
                        .clone()
                        .unwrap_or_else(|| "Uncategorized".to_string());
                    let ccolor = tx
                        .category_color
                        .clone()
                        .unwrap_or_else(|| "#94A3B8".to_string());
                    let item = cat_spend.entry(cid).or_insert((cname, ccolor, 0, 0));
                    item.2 += tx.amount_cents;
                    item.3 += 1;
                }
            }
        }

        let monthly_trends = trend_months
            .into_iter()
            .map(|(m, label)| {
                let (inc, exp) = trend_accum.get(&m).copied().unwrap_or((0, 0));
                MonthlyTrendPoint {
                    month: m,
                    label,
                    income_cents: inc,
                    expense_cents: exp,
                    net_cents: inc - exp,
                }
            })
            .collect();

        let mut category_points: Vec<CategorySpendingPoint> = cat_spend
            .into_iter()
            .filter_map(|(cid, (cname, ccolor, net_signed, count))| {
                let spent = (-net_signed).max(0);
                if spent > 0 {
                    Some(CategorySpendingPoint {
                        category_id: cid,
                        category_name: cname,
                        color: ccolor,
                        amount_cents: spent,
                        transaction_count: count,
                        percentage: 0.0,
                    })
                } else {
                    None
                }
            })
            .collect();

        category_points.sort_by(|a, b| b.amount_cents.cmp(&a.amount_cents));
        let total_cat_spend: i64 = category_points.iter().map(|p| p.amount_cents).sum();
        if total_cat_spend > 0 {
            for p in &mut category_points {
                p.percentage = ((p.amount_cents as f64 / total_cat_spend as f64) * 1000.0).round() / 10.0;
            }
        }

        let recent_transactions = all_txs.into_iter().take(12).collect();

        Ok(DashboardSummary {
            month: month.to_string(),
            assets_cents,
            liabilities_cents,
            net_worth_cents,
            month_income_cents,
            month_expense_cents,
            month_net_cents: month_income_cents - month_expense_cents,
            total_budgeted_cents: budget_summary.total_budgeted_cents,
            total_budget_spent_cents: budget_summary.total_spent_cents,
            uncategorized_count,
            accounts,
            upcoming_bills,
            monthly_trends,
            top_spending_categories: category_points,
            recent_transactions,
        })
    }

    // =========================================================================
    // Backup, Restore, Storage Info & Sample Starter Data
    // =========================================================================

    pub fn export_backup_json(&self) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;

        let accounts: Vec<StoredAccountRecord> = {
            let mut s = conn
                .prepare("SELECT id, name, account_type, institution, opening_balance_cents, opening_date, notes, created_at, currency, interest_rate_basis_points, term_months, monthly_payment_cents FROM accounts ORDER BY created_at ASC, id ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(StoredAccountRecord {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        account_type: r.get(2)?,
                        institution: r.get(3)?,
                        opening_balance_cents: r.get(4)?,
                        opening_date: r.get(5)?,
                        notes: r.get(6)?,
                        created_at: r.get(7)?,
                        currency: r.get(8)?,
                        interest_rate_basis_points: r.get(9)?,
                        term_months: r.get(10)?,
                        monthly_payment_cents: r.get(11)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let categories: Vec<Category> = {
            let mut s = conn
                .prepare("SELECT id, name, group_name, kind, color, tax_schedule FROM categories ORDER BY id ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(Category {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        group_name: r.get(2)?,
                        kind: r.get(3)?,
                        color: r.get(4)?,
                        tax_schedule: r.get(5)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let category_rules: Vec<StoredCategoryRuleRecord> = {
            let mut s = conn
                .prepare("SELECT id, pattern, match_type, category_id, rename_payee, account_id, priority FROM category_rules ORDER BY priority DESC, id ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(StoredCategoryRuleRecord {
                        id: r.get(0)?,
                        pattern: r.get(1)?,
                        match_type: r.get(2)?,
                        category_id: r.get(3)?,
                        rename_payee: r.get(4)?,
                        account_id: r.get(5)?,
                        priority: r.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let transactions: Vec<StoredTransactionRecord> = {
            let mut s = conn
                .prepare("SELECT id, account_id, posted_date, payee, original_payee, memo, amount_cents, category_id, external_id, fingerprint, cleared, import_source, created_at, check_number FROM transactions ORDER BY posted_date ASC, id ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    let clr: i64 = r.get(10)?;
                    Ok(StoredTransactionRecord {
                        id: r.get(0)?,
                        account_id: r.get(1)?,
                        posted_date: r.get(2)?,
                        payee: r.get(3)?,
                        original_payee: r.get(4)?,
                        memo: r.get(5)?,
                        amount_cents: r.get(6)?,
                        category_id: r.get(7)?,
                        external_id: r.get(8)?,
                        fingerprint: r.get(9)?,
                        cleared: clr != 0,
                        import_source: r.get(11)?,
                        created_at: r.get(12)?,
                        check_number: r.get(13)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let budgets: Vec<StoredBudgetRecord> = {
            let mut s = conn
                .prepare("SELECT id, month, category_id, limit_cents FROM budgets ORDER BY month ASC, category_id ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(StoredBudgetRecord {
                        id: r.get(0)?,
                        month: r.get(1)?,
                        category_id: r.get(2)?,
                        limit_cents: r.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let recurring_bills: Vec<StoredRecurringBillRecord> = {
            let mut s = conn
                .prepare("SELECT id, name, payee, amount_cents, category_id, account_id, frequency, next_due_date, auto_pay, notes, active FROM recurring_bills ORDER BY id ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    let ap: i64 = r.get(8)?;
                    let act: i64 = r.get(10)?;
                    Ok(StoredRecurringBillRecord {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        payee: r.get(2)?,
                        amount_cents: r.get(3)?,
                        category_id: r.get(4)?,
                        account_id: r.get(5)?,
                        frequency: r.get(6)?,
                        next_due_date: r.get(7)?,
                        auto_pay: ap != 0,
                        notes: r.get(9)?,
                        active: act != 0,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let transaction_splits: Vec<TransactionSplit> = {
            let mut s = conn
                .prepare("SELECT id, transaction_id, category_id, amount_cents, memo FROM transaction_splits ORDER BY id ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(TransactionSplit {
                        id: r.get(0)?,
                        transaction_id: r.get(1)?,
                        category_id: r.get(2)?,
                        category_name: None,
                        category_color: None,
                        amount_cents: r.get(3)?,
                        memo: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let securities: Vec<Security> = {
            let mut s = conn
                .prepare("SELECT id, symbol, name, security_type, current_price_cents, currency, updated_at FROM securities ORDER BY symbol ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(Security {
                        id: r.get(0)?,
                        symbol: r.get(1)?,
                        name: r.get(2)?,
                        security_type: r.get(3)?,
                        current_price_cents: r.get(4)?,
                        currency: r.get(5)?,
                        updated_at: r.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let investment_transactions: Vec<InvestmentTransaction> = {
            let mut s = conn
                .prepare("SELECT id, account_id, security_id, action, tx_date, shares_micros, price_per_share_cents, commission_cents, total_amount_cents, memo, created_at FROM investment_transactions ORDER BY tx_date ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(InvestmentTransaction {
                        id: r.get(0)?,
                        account_id: r.get(1)?,
                        account_name: None,
                        security_id: r.get(2)?,
                        security_symbol: None,
                        security_name: None,
                        action: r.get(3)?,
                        tx_date: r.get(4)?,
                        shares_micros: r.get(5)?,
                        price_per_share_cents: r.get(6)?,
                        commission_cents: r.get(7)?,
                        total_amount_cents: r.get(8)?,
                        memo: r.get(9)?,
                        created_at: r.get(10)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        let currency_rates: Vec<CurrencyRate> = {
            let mut s = conn
                .prepare("SELECT code, name, symbol, rate_to_usd_micros, updated_at FROM currency_rates ORDER BY code ASC")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([], |r| {
                    Ok(CurrencyRate {
                        code: r.get(0)?,
                        name: r.get(1)?,
                        symbol: r.get(2)?,
                        rate_to_usd_micros: r.get(3)?,
                        updated_at: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        create_backup_json(BackupPayload {
            accounts,
            categories,
            category_rules,
            transactions,
            budgets,
            recurring_bills,
            transaction_splits: Some(transaction_splits),
            securities: Some(securities),
            investment_transactions: Some(investment_transactions),
            currency_rates: Some(currency_rates),
        })
    }

    pub fn restore_backup_json(&self, raw_json: &str) -> Result<(), String> {
        let bundle = verify_and_parse_backup_json(raw_json)?;
        let p = bundle.payload;

        let mut conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute_batch(
            "DELETE FROM transaction_splits;
             DELETE FROM investment_transactions;
             DELETE FROM securities;
             DELETE FROM recurring_bills;
             DELETE FROM budgets;
             DELETE FROM transactions;
             DELETE FROM category_rules;
             DELETE FROM accounts;
             DELETE FROM categories;",
        )
        .map_err(|e| format!("Failed clearing existing records during restore: {}", e))?;

        for c in &p.categories {
            tx.execute(
                "INSERT INTO categories (id, name, group_name, kind, color, tax_schedule) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![c.id, c.name, c.group_name, c.kind, c.color, c.tax_schedule],
            )
            .map_err(|e| format!("Failed restoring category '{}': {}", c.name, e))?;
        }

        for a in &p.accounts {
            tx.execute(
                "INSERT INTO accounts (id, name, account_type, institution, opening_balance_cents, opening_date, notes, created_at, currency, interest_rate_basis_points, term_months, monthly_payment_cents)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    a.id,
                    a.name,
                    a.account_type,
                    a.institution,
                    a.opening_balance_cents,
                    a.opening_date,
                    a.notes,
                    a.created_at,
                    a.currency.clone().unwrap_or_else(|| "USD".to_string()),
                    a.interest_rate_basis_points,
                    a.term_months,
                    a.monthly_payment_cents
                ],
            )
            .map_err(|e| format!("Failed restoring account '{}': {}", a.name, e))?;
        }

        for r in &p.category_rules {
            tx.execute(
                "INSERT INTO category_rules (id, pattern, match_type, category_id, rename_payee, account_id, priority)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    r.id,
                    r.pattern,
                    r.match_type,
                    r.category_id,
                    r.rename_payee,
                    r.account_id,
                    r.priority
                ],
            )
            .map_err(|e| format!("Failed restoring categorization rule '{}': {}", r.pattern, e))?;
        }

        for t in &p.transactions {
            tx.execute(
                "INSERT INTO transactions (
                    id, account_id, posted_date, payee, original_payee, memo,
                    amount_cents, category_id, external_id, fingerprint, cleared, import_source, created_at, check_number
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    t.id,
                    t.account_id,
                    t.posted_date,
                    t.payee,
                    t.original_payee,
                    t.memo,
                    t.amount_cents,
                    t.category_id,
                    t.external_id,
                    t.fingerprint,
                    if t.cleared { 1 } else { 0 },
                    t.import_source,
                    t.created_at,
                    t.check_number
                ],
            )
            .map_err(|e| format!("Failed restoring transaction '{}': {}", t.id, e))?;
        }

        for b in &p.budgets {
            tx.execute(
                "INSERT INTO budgets (id, month, category_id, limit_cents) VALUES (?1, ?2, ?3, ?4)",
                params![b.id, b.month, b.category_id, b.limit_cents],
            )
            .map_err(|e| format!("Failed restoring budget '{}': {}", b.id, e))?;
        }

        for bill in &p.recurring_bills {
            tx.execute(
                "INSERT INTO recurring_bills (
                    id, name, payee, amount_cents, category_id, account_id,
                    frequency, next_due_date, auto_pay, notes, active
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    bill.id,
                    bill.name,
                    bill.payee,
                    bill.amount_cents,
                    bill.category_id,
                    bill.account_id,
                    bill.frequency,
                    bill.next_due_date,
                    if bill.auto_pay { 1 } else { 0 },
                    bill.notes,
                    if bill.active { 1 } else { 0 }
                ],
            )
            .map_err(|e| format!("Failed restoring recurring bill '{}': {}", bill.name, e))?;
        }

        if let Some(ref splits) = p.transaction_splits {
            for s in splits {
                tx.execute(
                    "INSERT INTO transaction_splits (id, transaction_id, category_id, amount_cents, memo)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![s.id, s.transaction_id, s.category_id, s.amount_cents, s.memo],
                )
                .map_err(|e| format!("Failed restoring split '{}': {}", s.id, e))?;
            }
        }

        if let Some(ref secs) = p.securities {
            for s in secs {
                tx.execute(
                    "INSERT INTO securities (id, symbol, name, security_type, current_price_cents, currency, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![s.id, s.symbol, s.name, s.security_type, s.current_price_cents, s.currency, s.updated_at],
                )
                .map_err(|e| format!("Failed restoring security '{}': {}", s.symbol, e))?;
            }
        }

        if let Some(ref inv_txs) = p.investment_transactions {
            for it in inv_txs {
                tx.execute(
                    "INSERT INTO investment_transactions (id, account_id, security_id, action, tx_date, shares_micros, price_per_share_cents, commission_cents, total_amount_cents, memo, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![it.id, it.account_id, it.security_id, it.action, it.tx_date, it.shares_micros, it.price_per_share_cents, it.commission_cents, it.total_amount_cents, it.memo, it.created_at],
                )
                .map_err(|e| format!("Failed restoring investment transaction '{}': {}", it.id, e))?;
            }
        }

        if let Some(ref rates) = p.currency_rates {
            for cr in rates {
                tx.execute(
                    "INSERT OR REPLACE INTO currency_rates (code, name, symbol, rate_to_usd_micros, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![cr.code, cr.name, cr.symbol, cr.rate_to_usd_micros, cr.updated_at],
                )
                .map_err(|e| format!("Failed restoring currency rate '{}': {}", cr.code, e))?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn reset_all_data(&self) -> Result<(), String> {
        {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            conn.execute_batch(
                "DELETE FROM recurring_bills;
                 DELETE FROM budgets;
                 DELETE FROM transactions;
                 DELETE FROM category_rules;
                 DELETE FROM accounts;
                 DELETE FROM categories;",
            )
            .map_err(|e| e.to_string())?;
        }
        self.seed_defaults_if_empty()
    }

    pub fn get_storage_info(&self) -> Result<StorageInfo, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let account_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let transaction_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let category_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let rule_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM category_rules", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let bill_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM recurring_bills", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;

        let (database_path, database_size_bytes) = match &self.path {
            Some(p) => {
                let sz = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                (p.display().to_string(), sz)
            }
            None => ("In-memory SQLite database".to_string(), 0),
        };

        Ok(StorageInfo {
            database_path,
            database_size_bytes,
            account_count,
            transaction_count,
            category_count,
            rule_count,
            bill_count,
        })
    }

    /// Populates realistic sample household data anchored to `reference_month` (`YYYY-MM`) so new users can explore immediately.
    pub fn load_sample_household_data(&self, reference_month: &str) -> Result<(), String> {
        self.reset_all_data()?;

        let anchor = NaiveDate::parse_from_str(&format!("{}-01", reference_month), "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2026, 10, 1).unwrap());
        let prev = anchor
            .checked_sub_months(Months::new(1))
            .unwrap_or(anchor);
        let next = anchor
            .checked_add_months(Months::new(1))
            .unwrap_or(anchor);

        let cur_ym = anchor.format("%Y-%m").to_string();
        let prev_ym = prev.format("%Y-%m").to_string();
        let next_ym = next.format("%Y-%m").to_string();

        let checking = self.upsert_account(&UpsertAccountInput {
            id: Some("acc-checking".to_string()),
            name: "Household Checking".to_string(),
            account_type: "checking".to_string(),
            institution: "First Federal Credit Union".to_string(),
            opening_balance_cents: 485_000, // $4,850.00
            opening_date: format!("{}-01", prev_ym),
            notes: Some("Primary joint checking for paychecks and monthly bills".to_string()),
            currency: Some("USD".to_string()),
            interest_rate_basis_points: None,
            term_months: None,
            monthly_payment_cents: None,
        })?;

        let savings = self.upsert_account(&UpsertAccountInput {
            id: Some("acc-savings".to_string()),
            name: "Emergency Savings".to_string(),
            account_type: "savings".to_string(),
            institution: "First Federal Credit Union".to_string(),
            opening_balance_cents: 2_450_000, // $24,500.00
            opening_date: format!("{}-01", prev_ym),
            notes: Some("6-month household emergency reserve".to_string()),
            currency: Some("USD".to_string()),
            interest_rate_basis_points: None,
            term_months: None,
            monthly_payment_cents: None,
        })?;

        let card = self.upsert_account(&UpsertAccountInput {
            id: Some("acc-visa".to_string()),
            name: "Everyday Rewards Visa".to_string(),
            account_type: "credit_card".to_string(),
            institution: "Harbor Bank".to_string(),
            opening_balance_cents: -42_500, // -$425.00 starting card balance
            opening_date: format!("{}-01", prev_ym),
            notes: Some("Groceries, fuel, and everyday household spending".to_string()),
            currency: Some("USD".to_string()),
            interest_rate_basis_points: None,
            term_months: None,
            monthly_payment_cents: None,
        })?;

        let _retirement = self.upsert_account(&UpsertAccountInput {
            id: Some("acc-retirement".to_string()),
            name: "Household Index Retirement".to_string(),
            account_type: "investment".to_string(),
            institution: "Vanguard".to_string(),
            opening_balance_cents: 8_420_000, // $84,200.00
            opening_date: format!("{}-01", prev_ym),
            notes: Some("Long-term index retirement account".to_string()),
            currency: Some("USD".to_string()),
            interest_rate_basis_points: None,
            term_months: None,
            monthly_payment_cents: None,
        })?;

        let sample_txs = [
            // Previous month
            (&checking.id, format!("{}-01", prev_ym), "Employer Payroll", "Biweekly direct deposit", 315_000, Some("cat-income-paycheck")),
            (&checking.id, format!("{}-02", prev_ym), "Oakridge Mortgage", "Monthly mortgage payment", -185_000, Some("cat-housing")),
            (&card.id, format!("{}-05", prev_ym), "Trader Joe's", "Weekly groceries", -14_280, Some("cat-groceries")),
            (&checking.id, format!("{}-10", prev_ym), "City Electric & Gas", "Monthly electric utility", -13_840, Some("cat-utilities")),
            (&checking.id, format!("{}-15", prev_ym), "Employer Payroll", "Biweekly direct deposit", 315_000, Some("cat-income-paycheck")),
            (&card.id, format!("{}-18", prev_ym), "Whole Foods Market", "Produce & pantry", -16_420, Some("cat-groceries")),
            (&card.id, format!("{}-21", prev_ym), "Shell", "Regular unleaded", -4_850, Some("cat-transport")),
            (&checking.id, format!("{}-25", prev_ym), "Harbor Visa Autopay", "Pay credit card statement", -50_000, Some("cat-transfer")),
            (&card.id, format!("{}-25", prev_ym), "Payment Thank You", "Autopay received", 50_000, Some("cat-transfer")),
            (&checking.id, format!("{}-28", prev_ym), "Savings Transfer", "Monthly emergency fund transfer", -40_000, Some("cat-transfer")),
            (&savings.id, format!("{}-28", prev_ym), "Savings Transfer", "Monthly emergency fund transfer", 40_000, Some("cat-transfer")),
            // Current month
            (&checking.id, format!("{}-01", cur_ym), "Employer Payroll", "Biweekly direct deposit", 315_000, Some("cat-income-paycheck")),
            (&checking.id, format!("{}-02", cur_ym), "Oakridge Mortgage", "Monthly mortgage payment", -185_000, Some("cat-housing")),
            (&card.id, format!("{}-04", cur_ym), "Trader Joe's", "Weekly household groceries", -15_640, Some("cat-groceries")),
            (&checking.id, format!("{}-07", cur_ym), "Xfinity Internet", "Home fiber internet", -7_500, Some("cat-utilities")),
            (&card.id, format!("{}-09", cur_ym), "Blue Bottle Coffee", "Saturday morning coffee", -1_480, Some("cat-dining")),
            (&card.id, format!("{}-11", cur_ym), "Shell", "Highway fill-up", -5_120, Some("cat-transport")),
            (&card.id, format!("{}-13", cur_ym), "CVS Pharmacy", "Prescription & household essentials", -3_490, Some("cat-healthcare")),
            (&checking.id, format!("{}-15", cur_ym), "Employer Payroll", "Biweekly direct deposit", 315_000, Some("cat-income-paycheck")),
            (&card.id, format!("{}-16", cur_ym), "Costco", "Bulk pantry & paper goods", -21_850, Some("cat-groceries")),
            (&card.id, format!("{}-19", cur_ym), "Amazon", "Kitchen storage & lightbulbs", -6_420, Some("cat-household")),
            (&card.id, format!("{}-21", cur_ym), "Netflix", "Monthly family plan", -2_299, Some("cat-subscriptions")),
            (&card.id, format!("{}-23", cur_ym), "Local Bistro", "Anniversary dinner", -9_650, Some("cat-dining")),
            (&card.id, format!("{}-24", cur_ym), "CORNER HARDWARE #402", "Garden hose & brackets", -3_875, None),
        ];

        for (acc_id, dt, payee, memo, amt, cat) in sample_txs {
            self.upsert_transaction(&UpsertTransactionInput {
                id: None,
                account_id: acc_id.to_string(),
                posted_date: dt,
                payee: payee.to_string(),
                memo: Some(memo.to_string()),
                amount_cents: amt,
                category_id: cat.map(|s| s.to_string()),
                cleared: Some(true),
                check_number: None,
                splits: None,
            })?;
        }

        let sample_budgets = [
            ("cat-housing", 185_000),
            ("cat-groceries", 65_000),
            ("cat-utilities", 26_000),
            ("cat-transport", 18_000),
            ("cat-dining", 22_000),
            ("cat-household", 20_000),
            ("cat-healthcare", 12_000),
            ("cat-subscriptions", 6_500),
        ];
        for (cid, limit) in sample_budgets {
            self.set_category_budget(&cur_ym, cid, limit)?;
        }

        let due_soon_day = (anchor.day().min(25) + 2).min(28);
        self.upsert_recurring_bill(
            &UpsertRecurringBillInput {
                id: None,
                name: "City Electric & Gas".to_string(),
                payee: "City Electric & Gas".to_string(),
                amount_cents: 14_200,
                category_id: Some("cat-utilities".to_string()),
                account_id: Some(checking.id.clone()),
                frequency: "monthly".to_string(),
                next_due_date: format!("{}-{:02}", cur_ym, due_soon_day.max(28)),
                auto_pay: false,
                notes: Some("Check meter reading on winter bills".to_string()),
                active: Some(true),
            },
            &format!("{}-26", cur_ym),
        )?;

        self.upsert_recurring_bill(
            &UpsertRecurringBillInput {
                id: None,
                name: "Oakridge Mortgage".to_string(),
                payee: "Oakridge Mortgage".to_string(),
                amount_cents: 185_000,
                category_id: Some("cat-housing".to_string()),
                account_id: Some(checking.id.clone()),
                frequency: "monthly".to_string(),
                next_due_date: format!("{}-02", next_ym),
                auto_pay: true,
                notes: Some("Auto-drafted on the 2nd".to_string()),
                active: Some(true),
            },
            &format!("{}-26", cur_ym),
        )?;

        self.upsert_recurring_bill(
            &UpsertRecurringBillInput {
                id: None,
                name: "Auto & Home Insurance".to_string(),
                payee: "Mutual Family Insurance".to_string(),
                amount_cents: 16_800,
                category_id: Some("cat-insurance".to_string()),
                account_id: Some(checking.id.clone()),
                frequency: "monthly".to_string(),
                next_due_date: format!("{}-12", next_ym),
                auto_pay: true,
                notes: Some("Combined household policy".to_string()),
                active: Some(true),
            },
            &format!("{}-26", cur_ym),
        )?;

        // Seed Sample Loan Account
        let _mortgage_loan = self.upsert_account(&UpsertAccountInput {
            id: Some("acc-mortgage-loan".to_string()),
            name: "Oakridge Home Mortgage Loan".to_string(),
            account_type: "loan".to_string(),
            institution: "Oakridge Financial".to_string(),
            opening_balance_cents: -312_400_00, // -$312,400.00
            opening_date: format!("{}-01", prev_ym),
            notes: Some("30-year fixed home mortgage at 6.25% APR".to_string()),
            currency: Some("USD".to_string()),
            interest_rate_basis_points: Some(625),
            term_months: Some(360),
            monthly_payment_cents: Some(185_000),
        })?;

        // Seed Sample Securities
        let sec_vti = self.upsert_security(&UpsertSecurityInput {
            id: Some("sec-vti".to_string()),
            symbol: "VTI".to_string(),
            name: "Vanguard Total Stock Market ETF".to_string(),
            security_type: "etf".to_string(),
            current_price_cents: 28_540, // $285.40
            currency: Some("USD".to_string()),
        })?;

        let sec_vxus = self.upsert_security(&UpsertSecurityInput {
            id: Some("sec-vxus".to_string()),
            symbol: "VXUS".to_string(),
            name: "Vanguard Total International Stock ETF".to_string(),
            security_type: "etf".to_string(),
            current_price_cents: 5_920, // $59.20
            currency: Some("USD".to_string()),
        })?;

        let sec_bnd = self.upsert_security(&UpsertSecurityInput {
            id: Some("sec-bnd".to_string()),
            symbol: "BND".to_string(),
            name: "Vanguard Total Bond Market ETF".to_string(),
            security_type: "bond".to_string(),
            current_price_cents: 7_215, // $72.15
            currency: Some("USD".to_string()),
        })?;

        // Seed Investment Transactions in Retirement Account
        self.record_investment_tx(&RecordInvestmentTxInput {
            id: Some("inv-1".to_string()),
            account_id: _retirement.id.clone(),
            security_id: sec_vti.id.clone(),
            action: "buy".to_string(),
            tx_date: format!("{}-05", prev_ym),
            shares_micros: 180_000_000, // 180.0 shares
            price_per_share_cents: 24_000, // $240.00
            commission_cents: Some(0),
            total_amount_cents: Some(4_320_000), // $43,200.00
            memo: Some("Initial core US total market position".to_string()),
        })?;

        self.record_investment_tx(&RecordInvestmentTxInput {
            id: Some("inv-2".to_string()),
            account_id: _retirement.id.clone(),
            security_id: sec_vxus.id.clone(),
            action: "buy".to_string(),
            tx_date: format!("{}-10", prev_ym),
            shares_micros: 250_000_000, // 250.0 shares
            price_per_share_cents: 5_200, // $52.00
            commission_cents: Some(0),
            total_amount_cents: Some(1_300_000), // $13,000.00
            memo: Some("International stock diversification".to_string()),
        })?;

        self.record_investment_tx(&RecordInvestmentTxInput {
            id: Some("inv-3".to_string()),
            account_id: _retirement.id.clone(),
            security_id: sec_bnd.id.clone(),
            action: "buy".to_string(),
            tx_date: format!("{}-15", prev_ym),
            shares_micros: 200_000_000, // 200.0 shares
            price_per_share_cents: 7_000, // $70.00
            commission_cents: Some(0),
            total_amount_cents: Some(1_400_000), // $14,000.00
            memo: Some("Total bond index ballast".to_string()),
        })?;

        self.record_investment_tx(&RecordInvestmentTxInput {
            id: Some("inv-4".to_string()),
            account_id: _retirement.id.clone(),
            security_id: sec_vti.id.clone(),
            action: "reinvest".to_string(),
            tx_date: format!("{}-15", cur_ym),
            shares_micros: 1_850_000, // 1.85 shares reinvested
            price_per_share_cents: 28_000, // $280.00
            commission_cents: Some(0),
            total_amount_cents: Some(51_800), // $518.00 dividend
            memo: Some("Quarterly dividend reinvestment".to_string()),
        })?;

        Ok(())
    }

    // =========================================================================
    // Securities & Portfolio Tracking
    // =========================================================================

    pub fn list_securities(&self) -> Result<Vec<Security>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, symbol, name, security_type, current_price_cents, currency, updated_at FROM securities ORDER BY symbol ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Security {
                    id: r.get(0)?,
                    symbol: r.get(1)?,
                    name: r.get(2)?,
                    security_type: r.get(3)?,
                    current_price_cents: r.get(4)?,
                    currency: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn upsert_security(&self, input: &UpsertSecurityInput) -> Result<Security, String> {
        let symbol = input.symbol.trim().to_uppercase();
        if symbol.is_empty() {
            return Err("Security ticker symbol cannot be empty.".to_string());
        }
        let name = input.name.trim();
        if name.is_empty() {
            return Err("Security name cannot be empty.".to_string());
        }
        let id = input
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("sec-{}", Uuid::new_v4()));
        let currency = input.currency.clone().unwrap_or_else(|| "USD".to_string());
        let now = Utc::now().to_rfc3339();

        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute(
            "INSERT INTO securities (id, symbol, name, security_type, current_price_cents, currency, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                symbol = excluded.symbol,
                name = excluded.name,
                security_type = excluded.security_type,
                current_price_cents = excluded.current_price_cents,
                currency = excluded.currency,
                updated_at = excluded.updated_at",
            params![
                id,
                symbol,
                name,
                input.security_type.trim().to_lowercase(),
                input.current_price_cents,
                currency,
                now
            ],
        )
        .map_err(|e| format!("Could not save security '{}': {}", symbol, e))?;

        Ok(Security {
            id,
            symbol,
            name: name.to_string(),
            security_type: input.security_type.trim().to_lowercase(),
            current_price_cents: input.current_price_cents,
            currency,
            updated_at: now,
        })
    }

    pub fn delete_security(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute("DELETE FROM securities WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn record_investment_tx(&self, input: &RecordInvestmentTxInput) -> Result<InvestmentTransaction, String> {
        let id = input
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("inv-{}", Uuid::new_v4()));
        let now = Utc::now().to_rfc3339();
        let commission = input.commission_cents.unwrap_or(0);
        let total = input.total_amount_cents.unwrap_or_else(|| {
            let principal = (input.shares_micros as f64 / 1_000_000.0) * input.price_per_share_cents as f64;
            principal.round() as i64 + commission
        });

        {
            let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
            conn.execute(
                "INSERT INTO investment_transactions (
                    id, account_id, security_id, action, tx_date, shares_micros,
                    price_per_share_cents, commission_cents, total_amount_cents, memo, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                    account_id = excluded.account_id,
                    security_id = excluded.security_id,
                    action = excluded.action,
                    tx_date = excluded.tx_date,
                    shares_micros = excluded.shares_micros,
                    price_per_share_cents = excluded.price_per_share_cents,
                    commission_cents = excluded.commission_cents,
                    total_amount_cents = excluded.total_amount_cents,
                    memo = excluded.memo",
                params![
                    id,
                    input.account_id,
                    input.security_id,
                    input.action.trim().to_lowercase(),
                    input.tx_date.trim(),
                    input.shares_micros,
                    input.price_per_share_cents,
                    commission,
                    total,
                    input.memo.clone().unwrap_or_default().trim(),
                    now
                ],
            )
            .map_err(|e| format!("Could not record investment transaction: {}", e))?;
        }

        let txs = self.list_investment_transactions(Some(&input.account_id))?;
        txs.into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| "Saved investment transaction could not be re-queried.".to_string())
    }

    pub fn list_investment_transactions(&self, account_id: Option<&str>) -> Result<Vec<InvestmentTransaction>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    it.id, it.account_id, a.name,
                    it.security_id, s.symbol, s.name,
                    it.action, it.tx_date, it.shares_micros,
                    it.price_per_share_cents, it.commission_cents, it.total_amount_cents,
                    it.memo, it.created_at
                 FROM investment_transactions it
                 LEFT JOIN accounts a ON a.id = it.account_id
                 LEFT JOIN securities s ON s.id = it.security_id
                 ORDER BY it.tx_date DESC, it.created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                Ok(InvestmentTransaction {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    account_name: r.get(2)?,
                    security_id: r.get(3)?,
                    security_symbol: r.get(4)?,
                    security_name: r.get(5)?,
                    action: r.get(6)?,
                    tx_date: r.get(7)?,
                    shares_micros: r.get(8)?,
                    price_per_share_cents: r.get(9)?,
                    commission_cents: r.get(10)?,
                    total_amount_cents: r.get(11)?,
                    memo: r.get(12)?,
                    created_at: r.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let all = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        if let Some(acc) = account_id {
            if !acc.trim().is_empty() {
                return Ok(all.into_iter().filter(|t| t.account_id == acc).collect());
            }
        }
        Ok(all)
    }

    pub fn get_portfolio_summary(&self, account_id: Option<&str>) -> Result<PortfolioSummary, String> {
        let txs = self.list_investment_transactions(account_id)?;
        let securities = self.list_securities()?;
        let sec_map: HashMap<String, Security> = securities.into_iter().map(|s| (s.id.clone(), s)).collect();

        // Calculate holding balance per security
        let mut holdings_map: HashMap<String, (i64, i64)> = HashMap::new(); // sec_id -> (shares_micros, total_cost_cents)
        for t in &txs {
            let entry = holdings_map.entry(t.security_id.clone()).or_insert((0, 0));
            match t.action.as_str() {
                "buy" | "reinvest" => {
                    entry.0 += t.shares_micros;
                    entry.1 += t.total_amount_cents;
                }
                "sell" => {
                    // Reduce shares and reduce cost basis proportionally (average cost basis)
                    if entry.0 > 0 {
                        let cost_sold = (entry.1 as f64 * (t.shares_micros as f64 / entry.0 as f64)).round() as i64;
                        entry.0 = (entry.0 - t.shares_micros).max(0);
                        entry.1 = (entry.1 - cost_sold).max(0);
                    }
                }
                "split" => {
                    entry.0 += t.shares_micros;
                }
                _ => {}
            }
        }

        let mut holdings = Vec::new();
        let mut total_market_value_cents = 0i64;
        let mut total_cost_basis_cents = 0i64;

        for (sec_id, (shares_micros, total_cost_cents)) in holdings_map {
            if shares_micros <= 0 {
                continue;
            }
            if let Some(sec) = sec_map.get(&sec_id) {
                let current_price = sec.current_price_cents;
                let market_value_cents = ((shares_micros as f64 / 1_000_000.0) * current_price as f64).round() as i64;
                let unrealized_gain_cents = market_value_cents - total_cost_cents;
                let unrealized_gain_percent = if total_cost_cents > 0 {
                    (unrealized_gain_cents as f64 / total_cost_cents as f64) * 100.0
                } else {
                    0.0
                };
                let avg_cost_per_share_cents = ((total_cost_cents as f64 / (shares_micros as f64 / 1_000_000.0))).round() as i64;

                total_market_value_cents += market_value_cents;
                total_cost_basis_cents += total_cost_cents;

                holdings.push(HoldingSummary {
                    security_id: sec.id.clone(),
                    symbol: sec.symbol.clone(),
                    name: sec.name.clone(),
                    security_type: sec.security_type.clone(),
                    total_shares_micros: shares_micros,
                    total_cost_cents,
                    avg_cost_per_share_cents,
                    current_price_cents: current_price,
                    market_value_cents,
                    unrealized_gain_cents,
                    unrealized_gain_percent,
                });
            }
        }

        holdings.sort_by(|a, b| b.market_value_cents.cmp(&a.market_value_cents));

        Ok(PortfolioSummary {
            total_market_value_cents,
            total_cost_basis_cents,
            total_unrealized_gain_cents: total_market_value_cents - total_cost_basis_cents,
            holdings,
            transactions: txs,
        })
    }

    // =========================================================================
    // Tax Schedule & Itemized Deductions
    // =========================================================================

    pub fn get_tax_schedule_report(&self, year: i32) -> Result<TaxYearReport, String> {
        let year_prefix = format!("{}-", year);
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT
                    COALESCE(c.tax_schedule, 'Unassigned Schedule'),
                    c.id,
                    c.name,
                    c.kind,
                    COALESCE(s.amount_cents, t.amount_cents)
                 FROM transactions t
                 LEFT JOIN transaction_splits s ON s.transaction_id = t.id
                 LEFT JOIN categories c ON c.id = COALESCE(s.category_id, t.category_id)
                 WHERE t.posted_date LIKE ?1
                   AND c.tax_schedule IS NOT NULL
                   AND c.tax_schedule != ''
                 ORDER BY c.tax_schedule ASC, c.name ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![format!("{}%", year_prefix)], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut schedule_map: HashMap<(String, String, String), (i64, i64)> = HashMap::new(); // (schedule, cat_id, cat_name) -> (total_abs_cents, count)
        let mut total_deductions_cents = 0i64;
        let mut total_taxable_income_cents = 0i64;

        for r in rows {
            let (sched, cat_id, cat_name, kind, amt) = r.map_err(|e| e.to_string())?;
            let entry = schedule_map.entry((sched, cat_id, cat_name)).or_insert((0, 0));
            if kind == "income" {
                entry.0 += amt.abs();
                total_taxable_income_cents += amt.abs();
            } else {
                entry.0 += amt.abs();
                total_deductions_cents += amt.abs();
            }
            entry.1 += 1;
        }

        let mut schedules: Vec<TaxScheduleItem> = schedule_map
            .into_iter()
            .map(|((schedule_name, category_id, category_name), (total_amount_cents, transaction_count))| {
                TaxScheduleItem {
                    schedule_name,
                    category_id,
                    category_name,
                    total_amount_cents,
                    transaction_count,
                }
            })
            .collect();

        schedules.sort_by(|a, b| a.schedule_name.cmp(&b.schedule_name).then(b.total_amount_cents.cmp(&a.total_amount_cents)));

        drop(stmt);
        drop(conn);

        let matching_txs = self.list_transactions(&TransactionFilter {
            month: None,
            account_id: None,
            category_id: None,
            search: None,
            uncategorized_only: None,
        })?
        .into_iter()
        .filter(|t| t.posted_date.starts_with(&year_prefix))
        .collect();

        Ok(TaxYearReport {
            year,
            total_deductions_cents,
            total_taxable_income_cents,
            standard_deduction_single_cents: 1_500_000, // $15,000 for 2026
            standard_deduction_married_cents: 3_000_000, // $30,000 for 2026
            schedules,
            transactions: matching_txs,
        })
    }

    // =========================================================================
    // Loan Amortization & Debt Payoff
    // =========================================================================

    pub fn calculate_loan_amortization(
        &self,
        principal_cents: i64,
        apr_basis_points: i64,
        term_months: i32,
        extra_monthly_cents: i64,
    ) -> Result<LoanCalculation, String> {
        if principal_cents <= 0 {
            return Err("Loan principal must be greater than zero.".to_string());
        }
        if term_months <= 0 {
            return Err("Loan term must be at least 1 month.".to_string());
        }

        let r = (apr_basis_points as f64 / 10000.0) / 12.0;
        let monthly_payment_cents = if r > 0.0 {
            let n = term_months as f64;
            let factor = (1.0 + r).powf(n);
            let p = principal_cents as f64 * (r * factor) / (factor - 1.0);
            p.round() as i64
        } else {
            principal_cents / term_months as i64
        };

        let mut schedule = Vec::new();
        let mut current_balance = principal_cents;
        let mut total_interest = 0i64;
        let mut total_paid = 0i64;
        let start_date = Utc::now().date_naive();

        for m in 1..=(term_months * 2) {
            if current_balance <= 0 {
                break;
            }
            let interest = if r > 0.0 {
                ((current_balance as f64) * r).round() as i64
            } else {
                0
            };

            let payment_target = monthly_payment_cents + extra_monthly_cents;
            let total_due = current_balance + interest;
            let actual_payment = if m >= term_months && extra_monthly_cents == 0 {
                total_due
            } else {
                payment_target.min(total_due)
            };
            let principal = (actual_payment - interest).max(0);
            current_balance = (current_balance - principal).max(0);

            total_interest += interest;
            total_paid += actual_payment;

            let dt = start_date.checked_add_months(Months::new(m as u32)).unwrap_or(start_date);
            schedule.push(AmortizationMonth {
                month_index: m,
                date: dt.format("%Y-%m-%d").to_string(),
                payment_cents: actual_payment,
                principal_cents: principal,
                interest_cents: interest,
                remaining_balance_cents: current_balance,
            });

            if current_balance == 0 {
                break;
            }
        }

        Ok(LoanCalculation {
            principal_cents,
            interest_rate_basis_points: apr_basis_points,
            term_months,
            monthly_payment_cents,
            total_interest_cents: total_interest,
            total_paid_cents: total_paid,
            schedule,
        })
    }

    pub fn compare_loan_payoff(
        &self,
        principal_cents: i64,
        apr_basis_points: i64,
        term_months: i32,
        extra_monthly_cents: i64,
    ) -> Result<LoanPayoffComparison, String> {
        let standard = self.calculate_loan_amortization(principal_cents, apr_basis_points, term_months, 0)?;
        let accelerated = self.calculate_loan_amortization(principal_cents, apr_basis_points, term_months, extra_monthly_cents)?;

        let standard_months = standard.schedule.len() as i32;
        let accelerated_months = accelerated.schedule.len() as i32;
        let months_saved = (standard_months - accelerated_months).max(0);
        let interest_saved_cents = (standard.total_interest_cents - accelerated.total_interest_cents).max(0);

        Ok(LoanPayoffComparison {
            standard_months,
            standard_total_interest_cents: standard.total_interest_cents,
            accelerated_months,
            accelerated_total_interest_cents: accelerated.total_interest_cents,
            months_saved,
            interest_saved_cents,
        })
    }

    // =========================================================================
    // Legal Check Words & Multi-Currency Rates
    // =========================================================================

    pub fn convert_number_to_english_words(&self, amount_cents: i64) -> String {
        let abs_val = amount_cents.abs();
        let cents = abs_val % 100;
        let dollars = abs_val / 100;
        if dollars == 0 {
            return format!("Zero and {:02}/100 Dollars", cents);
        }

        fn small_words(n: i64) -> String {
            let ones = [
                "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
                "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
                "Seventeen", "Eighteen", "Nineteen",
            ];
            let tens = [
                "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
            ];

            if n < 20 {
                ones[n as usize].to_string()
            } else if n < 100 {
                let t = tens[(n / 10) as usize];
                let o = ones[(n % 10) as usize];
                if o.is_empty() {
                    t.to_string()
                } else {
                    format!("{}-{}", t, o)
                }
            } else {
                let h = ones[(n / 100) as usize];
                let rem = n % 100;
                if rem == 0 {
                    format!("{} Hundred", h)
                } else {
                    format!("{} Hundred {}", h, small_words(rem))
                }
            }
        }

        let billions = (dollars / 1_000_000_000) % 1_000;
        let millions = (dollars / 1_000_000) % 1_000;
        let thousands = (dollars / 1_000) % 1_000;
        let remainder = dollars % 1_000;

        let mut parts = Vec::new();
        if billions > 0 {
            parts.push(format!("{} Billion", small_words(billions)));
        }
        if millions > 0 {
            parts.push(format!("{} Million", small_words(millions)));
        }
        if thousands > 0 {
            parts.push(format!("{} Thousand", small_words(thousands)));
        }
        if remainder > 0 {
            parts.push(small_words(remainder));
        }

        let words = parts.join(" ");
        format!("{} and {:02}/100 Dollars", words, cents)
    }

    pub fn list_currency_rates(&self) -> Result<Vec<CurrencyRate>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT code, name, symbol, rate_to_usd_micros, updated_at FROM currency_rates ORDER BY code ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CurrencyRate {
                    code: r.get(0)?,
                    name: r.get(1)?,
                    symbol: r.get(2)?,
                    rate_to_usd_micros: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn upsert_currency_rate(&self, input: &UpsertCurrencyRateInput) -> Result<CurrencyRate, String> {
        let code = input.code.trim().to_uppercase();
        let name = input.name.trim();
        let symbol = input.symbol.trim();
        let now = Utc::now().to_rfc3339();

        let conn = self.conn.lock().map_err(|_| "Database lock poisoned".to_string())?;
        conn.execute(
            "INSERT INTO currency_rates (code, name, symbol, rate_to_usd_micros, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(code) DO UPDATE SET
                name = excluded.name,
                symbol = excluded.symbol,
                rate_to_usd_micros = excluded.rate_to_usd_micros,
                updated_at = excluded.updated_at",
            params![code, name, symbol, input.rate_to_usd_micros, now],
        )
        .map_err(|e| format!("Could not save currency rate '{}': {}", code, e))?;

        Ok(CurrencyRate {
            code,
            name: name.to_string(),
            symbol: symbol.to_string(),
            rate_to_usd_micros: input.rate_to_usd_micros,
            updated_at: now,
        })
    }

    // =========================================================================
    // Advanced Financial Reports
    // =========================================================================

    pub fn get_income_expense_report(&self, filter: &FinancialReportFilter) -> Result<IncomeExpenseReport, String> {
        let all_txs = self.list_transactions(&TransactionFilter {
            account_id: filter.account_id.clone(),
            category_id: None,
            month: None,
            search: None,
            uncategorized_only: None,
        })?;

        let start = filter.start_date.as_deref().unwrap_or("2000-01-01");
        let end = filter.end_date.as_deref().unwrap_or("2099-12-31");

        let mut total_income_cents = 0i64;
        let mut total_expense_cents = 0i64;
        let mut cat_breakdown_map: HashMap<String, (String, String, i64, i64)> = HashMap::new(); // cat_id -> (name, color, total_cents, count)
        let mut payee_map: HashMap<String, (i64, i64)> = HashMap::new(); // payee -> (total_spent_cents, count)

        for tx in all_txs {
            if tx.posted_date.as_str() < start || tx.posted_date.as_str() > end {
                continue;
            }
            let kind = tx.category_kind.as_deref().unwrap_or("expense");
            if kind == "transfer" {
                continue;
            }

            if tx.is_split && !tx.splits.is_empty() {
                for s in &tx.splits {
                    if s.amount_cents > 0 {
                        total_income_cents += s.amount_cents;
                    } else {
                        total_expense_cents += s.amount_cents.abs();
                        let cid = s.category_id.clone();
                        let cname = s.category_name.clone().unwrap_or_else(|| "Split Category".to_string());
                        let ccolor = s.category_color.clone().unwrap_or_else(|| "#4A6670".to_string());
                        let entry = cat_breakdown_map.entry(cid).or_insert((cname, ccolor, 0, 0));
                        entry.2 += s.amount_cents.abs();
                        entry.3 += 1;
                    }
                }
            } else if tx.amount_cents > 0 {
                total_income_cents += tx.amount_cents;
            } else {
                total_expense_cents += tx.amount_cents.abs();
                let cid = tx.category_id.clone().unwrap_or_else(|| "uncat".to_string());
                let cname = tx.category_name.clone().unwrap_or_else(|| "Uncategorized".to_string());
                let ccolor = tx.category_color.clone().unwrap_or_else(|| "#94A3B8".to_string());
                let entry = cat_breakdown_map.entry(cid).or_insert((cname, ccolor, 0, 0));
                entry.2 += tx.amount_cents.abs();
                entry.3 += 1;
            }

            if tx.amount_cents < 0 {
                let p_entry = payee_map.entry(tx.payee.clone()).or_insert((0, 0));
                p_entry.0 += tx.amount_cents.abs();
                p_entry.1 += 1;
            }
        }

        let mut category_breakdown: Vec<CategorySpendingPoint> = cat_breakdown_map
            .into_iter()
            .map(|(category_id, (category_name, color, amount_cents, transaction_count))| {
                CategorySpendingPoint {
                    category_id,
                    category_name,
                    color,
                    amount_cents,
                    transaction_count,
                    percentage: if total_expense_cents > 0 {
                        (amount_cents as f64 / total_expense_cents as f64) * 100.0
                    } else {
                        0.0
                    },
                }
            })
            .collect();
        category_breakdown.sort_by(|a, b| b.amount_cents.cmp(&a.amount_cents));

        let mut top_payees: Vec<PayeeSpendingPoint> = payee_map
            .into_iter()
            .map(|(payee, (total_spent_cents, transaction_count))| {
                PayeeSpendingPoint {
                    payee,
                    transaction_count,
                    total_spent_cents,
                    average_spent_cents: if transaction_count > 0 {
                        total_spent_cents / transaction_count
                    } else {
                        0
                    },
                }
            })
            .collect();
        top_payees.sort_by(|a, b| b.total_spent_cents.cmp(&a.total_spent_cents));
        top_payees.truncate(15);

        let net_savings_cents = total_income_cents - total_expense_cents;
        let savings_rate_percent = if total_income_cents > 0 {
            (net_savings_cents as f64 / total_income_cents as f64) * 100.0
        } else {
            0.0
        };

        Ok(IncomeExpenseReport {
            start_date: start.to_string(),
            end_date: end.to_string(),
            total_income_cents,
            total_expense_cents,
            net_savings_cents,
            savings_rate_percent,
            category_breakdown,
            top_payees,
        })
    }
}
