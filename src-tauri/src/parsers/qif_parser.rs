use crate::parsers::{parse_amount_to_cents, parse_flexible_date, ParsedRow, ParsedStatement};

pub fn parse_qif(content: &str) -> Result<ParsedStatement, String> {
    let mut rows = Vec::new();
    let mut warnings = Vec::new();

    let mut date_raw: Option<String> = None;
    let mut amount_raw: Option<String> = None;
    let mut u_amount_raw: Option<String> = None;
    let mut payee: Option<String> = None;
    let mut memo: Option<String> = None;
    let mut category: Option<String> = None;
    let mut number: Option<String> = None;
    let mut in_account_header = false;

    let flush_record = |date_raw: &mut Option<String>,
                        amount_raw: &mut Option<String>,
                        u_amount_raw: &mut Option<String>,
                        payee: &mut Option<String>,
                        memo: &mut Option<String>,
                        category: &mut Option<String>,
                        number: &mut Option<String>,
                        in_account_header: &mut bool,
                        rows: &mut Vec<ParsedRow>,
                        warnings: &mut Vec<String>|
     -> Result<(), String> {
        if *in_account_header {
            *in_account_header = false;
            *date_raw = None;
            *amount_raw = None;
            *u_amount_raw = None;
            *payee = None;
            *memo = None;
            *category = None;
            *number = None;
            return Ok(());
        }

        let amt_candidate = amount_raw.take().or_else(|| u_amount_raw.take());
        let dt_candidate = date_raw.take();
        let p_val = payee.take();
        let m_val = memo.take();
        let c_val = category.take();
        let n_val = number.take();

        if dt_candidate.is_none() && amt_candidate.is_none() {
            return Ok(());
        }

        let dt_str = match dt_candidate {
            Some(d) => parse_flexible_date(&d)?,
            None => {
                warnings.push("Skipped QIF entry without a D (date) field.".to_string());
                return Ok(());
            }
        };

        let amt_str = match amt_candidate {
            Some(a) => a,
            None => {
                warnings.push(format!("Skipped QIF entry on {} without a T (amount) field.", dt_str));
                return Ok(());
            }
        };
        let amount_cents = parse_amount_to_cents(&amt_str)?;

        let resolved_payee = match (&p_val, &m_val, &n_val) {
            (Some(p), _, _) if !p.trim().is_empty() => p.trim().to_string(),
            (_, Some(m), _) if !m.trim().is_empty() => m.trim().to_string(),
            (_, _, Some(n)) if !n.trim().is_empty() => format!("Check #{}", n.trim()),
            _ => "QIF transaction".to_string(),
        };

        let mut resolved_memo = m_val.unwrap_or_default().trim().to_string();
        if let Some(num) = n_val {
            let num_trim = num.trim();
            if !num_trim.is_empty() && !resolved_payee.contains(num_trim) {
                resolved_memo = if resolved_memo.is_empty() {
                    format!("Ref #{}", num_trim)
                } else {
                    format!("Ref #{} - {}", num_trim, resolved_memo)
                };
            }
        }

        // QIF `[Account Name]` in L field indicates a transfer
        let category_hint = c_val.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());

        rows.push(ParsedRow {
            posted_date: dt_str,
            payee: resolved_payee,
            memo: resolved_memo,
            amount_cents,
            external_id: None,
            category_hint,
        });
        Ok(())
    };

    for raw_line in content.lines() {
        let line = raw_line.trim_end_matches('\r').trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('!') {
            let header_lower = line.to_lowercase();
            in_account_header = header_lower.starts_with("!account");
            continue;
        }
        if line == "^" {
            flush_record(
                &mut date_raw,
                &mut amount_raw,
                &mut u_amount_raw,
                &mut payee,
                &mut memo,
                &mut category,
                &mut number,
                &mut in_account_header,
                &mut rows,
                &mut warnings,
            )?;
            continue;
        }

        let mut chars = line.chars();
        if let Some(code) = chars.next() {
            let rest = chars.as_str().trim().to_string();
            match code {
                'D' | 'd' => date_raw = Some(rest),
                'T' | 't' => amount_raw = Some(rest),
                'U' | 'u' => u_amount_raw = Some(rest),
                'P' | 'p' => payee = Some(rest),
                'M' | 'm' => memo = Some(rest),
                'L' | 'l' => category = Some(rest),
                'N' | 'n' => number = Some(rest),
                _ => {} // Ignore split/address/cleared flags not needed for register entry
            }
        }
    }

    // Flush trailing record if file omitted final `^`
    flush_record(
        &mut date_raw,
        &mut amount_raw,
        &mut u_amount_raw,
        &mut payee,
        &mut memo,
        &mut category,
        &mut number,
        &mut in_account_header,
        &mut rows,
        &mut warnings,
    )?;

    if rows.is_empty() {
        return Err(
            "No valid QIF transactions were found. Make sure the file uses standard Quicken Interchange Format (!Type:Bank / !Type:CCard records separated by '^')."
                .to_string(),
        );
    }

    Ok(ParsedStatement {
        format: "qif".to_string(),
        rows,
        statement_balance_cents: None,
        csv_headers: None,
        inferred_csv_mapping: None,
        warnings,
    })
}
