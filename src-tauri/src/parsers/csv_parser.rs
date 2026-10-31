use crate::models::CsvColumnMapping;
use crate::parsers::{parse_amount_to_cents, parse_flexible_date, ParsedRow, ParsedStatement};

fn split_csv_records(content: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut current_row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = content.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
        } else if ch == '"' && field.trim().is_empty() {
            in_quotes = true;
        } else if ch == delimiter {
            current_row.push(field.trim().to_string());
            field.clear();
        } else if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            current_row.push(field.trim().to_string());
            field.clear();
            if current_row.iter().any(|cell| !cell.is_empty()) {
                rows.push(current_row);
            }
            current_row = Vec::new();
        } else if ch == '\n' {
            current_row.push(field.trim().to_string());
            field.clear();
            if current_row.iter().any(|cell| !cell.is_empty()) {
                rows.push(current_row);
            }
            current_row = Vec::new();
        } else {
            field.push(ch);
        }
    }

    if !field.is_empty() || !current_row.is_empty() {
        current_row.push(field.trim().to_string());
        if current_row.iter().any(|cell| !cell.is_empty()) {
            rows.push(current_row);
        }
    }

    rows
}

fn detect_delimiter(content: &str) -> char {
    let sample_lines: Vec<&str> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(8)
        .collect();
    let candidates = [',', ';', '\t'];
    let mut best = ',';
    let mut best_score = 0usize;
    for cand in candidates {
        let counts: Vec<usize> = sample_lines
            .iter()
            .map(|l| l.chars().filter(|&c| c == cand).count())
            .filter(|&c| c > 0)
            .collect();
        if !counts.is_empty() {
            let total: usize = counts.iter().sum();
            if total > best_score {
                best_score = total;
                best = cand;
            }
        }
    }
    best
}

fn header_score(cells: &[String]) -> usize {
    let keywords = [
        "date",
        "posted",
        "description",
        "payee",
        "merchant",
        "name",
        "memo",
        "amount",
        "debit",
        "credit",
        "withdrawal",
        "deposit",
        "outflow",
        "inflow",
        "category",
    ];
    cells
        .iter()
        .filter(|cell| {
            let lower = cell.to_lowercase();
            keywords.iter().any(|kw| lower.contains(kw))
        })
        .count()
}

fn infer_mapping(headers: &[String]) -> CsvColumnMapping {
    let mut mapping = CsvColumnMapping::default();

    for (idx, raw) in headers.iter().enumerate() {
        let h = raw.trim().to_lowercase();
        if mapping.date_col.is_none()
            && (h == "date"
                || h == "transaction date"
                || h == "posted date"
                || h == "posting date"
                || h.contains("date"))
        {
            mapping.date_col = Some(idx);
            continue;
        }
        if mapping.payee_col.is_none()
            && (h == "payee"
                || h == "description"
                || h == "merchant"
                || h == "name"
                || h == "transaction description"
                || h.contains("payee")
                || h.contains("description")
                || h.contains("merchant"))
        {
            mapping.payee_col = Some(idx);
            continue;
        }
        if mapping.memo_col.is_none()
            && (h == "memo" || h == "note" || h == "notes" || h == "details" || h.contains("memo"))
        {
            mapping.memo_col = Some(idx);
            continue;
        }
        if mapping.amount_col.is_none()
            && (h == "amount" || h == "transaction amount" || h == "amt" || h == "value")
        {
            mapping.amount_col = Some(idx);
            continue;
        }
        if mapping.debit_col.is_none()
            && (h == "debit"
                || h == "withdrawal"
                || h == "withdrawals"
                || h == "outflow"
                || h == "charge"
                || h.contains("debit")
                || h.contains("withdrawal"))
        {
            mapping.debit_col = Some(idx);
            continue;
        }
        if mapping.credit_col.is_none()
            && (h == "credit"
                || h == "deposit"
                || h == "deposits"
                || h == "inflow"
                || h == "payment"
                || h.contains("credit")
                || h.contains("deposit"))
        {
            mapping.credit_col = Some(idx);
            continue;
        }
        if mapping.external_id_col.is_none()
            && (h == "id"
                || h == "transaction id"
                || h == "reference"
                || h == "ref"
                || h == "fitid")
        {
            mapping.external_id_col = Some(idx);
        }
    }

    // Fallback for generic amount header containing "amount"
    if mapping.amount_col.is_none() && mapping.debit_col.is_none() {
        for (idx, raw) in headers.iter().enumerate() {
            if raw.to_lowercase().contains("amount") {
                mapping.amount_col = Some(idx);
                break;
            }
        }
    }

    mapping
}

pub fn parse_csv(
    content: &str,
    user_mapping: Option<&CsvColumnMapping>,
) -> Result<ParsedStatement, String> {
    let delimiter = detect_delimiter(content);
    let raw_rows = split_csv_records(content, delimiter);
    if raw_rows.len() < 2 {
        return Err(
            "CSV statement must include a header row and at least one transaction row.".to_string(),
        );
    }

    // Locate header row within the first 10 rows (skips bank preamble lines like "Account: 1234")
    let mut header_idx = 0usize;
    let mut best_score = 0usize;
    for (idx, r) in raw_rows.iter().take(10).enumerate() {
        let score = header_score(r);
        if score > best_score && r.len() >= 2 {
            best_score = score;
            header_idx = idx;
        }
    }

    let headers = raw_rows[header_idx].clone();
    let inferred = infer_mapping(&headers);
    let effective = if let Some(u) = user_mapping {
        CsvColumnMapping {
            date_col: u.date_col.or(inferred.date_col),
            payee_col: u.payee_col.or(inferred.payee_col),
            memo_col: u.memo_col.or(inferred.memo_col),
            amount_col: u.amount_col.or(inferred.amount_col),
            debit_col: u.debit_col.or(inferred.debit_col),
            credit_col: u.credit_col.or(inferred.credit_col),
            external_id_col: u.external_id_col.or(inferred.external_id_col),
            invert_amount: u.invert_amount.or(inferred.invert_amount),
        }
    } else {
        inferred.clone()
    };

    let date_col = effective.date_col.ok_or_else(|| {
        format!(
            "Could not automatically identify a Date column from headers [{}]. Choose the Date column in the column mapper.",
            headers.join(", ")
        )
    })?;
    let payee_col = effective.payee_col.ok_or_else(|| {
        format!(
            "Could not automatically identify a Description/Payee column from headers [{}]. Choose the Payee column in the column mapper.",
            headers.join(", ")
        )
    })?;

    if effective.amount_col.is_none()
        && effective.debit_col.is_none()
        && effective.credit_col.is_none()
    {
        return Err(format!(
            "Could not identify an Amount or Debit/Credit column from headers [{}]. Choose the Amount column in the column mapper.",
            headers.join(", ")
        ));
    }

    let invert = effective.invert_amount.unwrap_or(false);
    let mut parsed_rows = Vec::new();
    let mut warnings = Vec::new();

    for (offset, cells) in raw_rows.iter().skip(header_idx + 1).enumerate() {
        let line_number = header_idx + offset + 2;
        if cells.iter().all(|c| c.trim().is_empty()) {
            continue;
        }
        let get_cell = |col: usize| -> &str { cells.get(col).map(|s| s.as_str()).unwrap_or("") };

        let date_raw = get_cell(date_col);
        if date_raw.trim().is_empty() {
            warnings.push(format!("Skipped row {}: blank date.", line_number));
            continue;
        }
        let posted_date = parse_flexible_date(date_raw)
            .map_err(|e| format!("Row {}: {}", line_number, e))?;

        let mut payee = get_cell(payee_col).trim().to_string();
        if payee.is_empty() {
            payee = "Unspecified payee".to_string();
        }

        let memo = effective
            .memo_col
            .map(get_cell)
            .unwrap_or("")
            .trim()
            .to_string();

        let amount_cents = if let (Some(d_col), Some(c_col)) = (effective.debit_col, effective.credit_col) {
            let d_raw = get_cell(d_col).trim();
            let c_raw = get_cell(c_col).trim();
            if d_raw.is_empty() && c_raw.is_empty() {
                if let Some(a_col) = effective.amount_col {
                    parse_amount_to_cents(get_cell(a_col))
                        .map_err(|e| format!("Row {}: {}", line_number, e))?
                } else {
                    warnings.push(format!("Skipped row {}: both Debit and Credit are blank.", line_number));
                    continue;
                }
            } else {
                let debit = if d_raw.is_empty() {
                    0
                } else {
                    parse_amount_to_cents(d_raw)
                        .map_err(|e| format!("Row {} (Debit): {}", line_number, e))?
                        .abs()
                };
                let credit = if c_raw.is_empty() {
                    0
                } else {
                    parse_amount_to_cents(c_raw)
                        .map_err(|e| format!("Row {} (Credit): {}", line_number, e))?
                        .abs()
                };
                credit - debit
            }
        } else if let Some(a_col) = effective.amount_col {
            let a_raw = get_cell(a_col).trim();
            if a_raw.is_empty() {
                warnings.push(format!("Skipped row {}: blank amount.", line_number));
                continue;
            }
            parse_amount_to_cents(a_raw).map_err(|e| format!("Row {}: {}", line_number, e))?
        } else if let Some(d_col) = effective.debit_col {
            let d_raw = get_cell(d_col).trim();
            if d_raw.is_empty() {
                continue;
            }
            -parse_amount_to_cents(d_raw)
                .map_err(|e| format!("Row {}: {}", line_number, e))?
                .abs()
        } else {
            0
        };

        let final_amount = if invert { -amount_cents } else { amount_cents };
        let external_id = effective
            .external_id_col
            .map(get_cell)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        parsed_rows.push(ParsedRow {
            posted_date,
            payee,
            memo,
            amount_cents: final_amount,
            external_id,
            category_hint: None,
        });
    }

    if parsed_rows.is_empty() {
        return Err("No valid transaction rows were found in this CSV statement.".to_string());
    }

    Ok(ParsedStatement {
        format: "csv".to_string(),
        rows: parsed_rows,
        statement_balance_cents: None,
        csv_headers: Some(headers),
        inferred_csv_mapping: Some(effective),
        warnings,
    })
}
