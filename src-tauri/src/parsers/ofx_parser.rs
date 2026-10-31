use crate::parsers::{parse_amount_to_cents, parse_flexible_date, ParsedRow, ParsedStatement};

fn unescape_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

/// Extracts value of an OFX SGML or XML tag within a block (`<TAG>value` up to next `<` or newline).
fn extract_ofx_tag(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let upper = block.to_uppercase();
    let start_idx = upper.find(&open)? + open.len();
    let rest = &block[start_idx..];

    // Value ends at closing tag `</TAG>` or next tag `<` or line break in SGML OFX
    let close_upper = format!("</{}>", tag);
    let rest_upper = rest.to_uppercase();
    let end_idx = if let Some(ci) = rest_upper.find(&close_upper) {
        ci
    } else {
        rest.find(['<', '\r', '\n']).unwrap_or(rest.len())
    };

    let val = unescape_entities(&rest[..end_idx]);
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

fn parse_ofx_date(raw: &str) -> Result<String, String> {
    // OFX dates look like `20261015120000.000[-5:EST]` or `20261015`
    let digits: String = raw.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 8 {
        parse_flexible_date(&digits[..8])
    } else {
        parse_flexible_date(raw)
    }
}

pub fn parse_ofx(content: &str) -> Result<ParsedStatement, String> {
    let upper = content.to_uppercase();
    if !upper.contains("<STMTTRN>") && !upper.contains("<OFX") && !upper.contains("OFXHEADER") {
        return Err(
            "This file does not appear to be a valid OFX or QFX bank statement (missing <OFX> / <STMTTRN> records)."
                .to_string(),
        );
    }

    let statement_balance_cents = upper.find("<LEDGERBAL>").and_then(|idx| {
        let sub = &content[idx..];
        let end = sub
            .to_uppercase()
            .find("</LEDGERBAL>")
            .or_else(|| sub.to_uppercase().find("<AVAILBAL>"))
            .unwrap_or(sub.len().min(256));
        extract_ofx_tag(&sub[..end], "BALAMT").and_then(|v| parse_amount_to_cents(&v).ok())
    });

    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    let mut search_pos = 0usize;

    while let Some(rel_start) = upper[search_pos..].find("<STMTTRN>") {
        let block_start = search_pos + rel_start + "<STMTTRN>".len();
        let next_trn = upper[block_start..].find("<STMTTRN>");
        let close_trn = upper[block_start..].find("</STMTTRN>");
        let end_rel = match (close_trn, next_trn) {
            (Some(c), Some(n)) => c.min(n),
            (Some(c), None) => c,
            (None, Some(n)) => n,
            (None, None) => content.len() - block_start,
        };
        let block = &content[block_start..block_start + end_rel];
        search_pos = block_start + end_rel;

        let dt_raw = match extract_ofx_tag(block, "DTPOSTED")
            .or_else(|| extract_ofx_tag(block, "DTUSER"))
        {
            Some(v) => v,
            None => {
                warnings.push("Skipped an OFX <STMTTRN> entry missing <DTPOSTED>.".to_string());
                continue;
            }
        };
        let posted_date = parse_ofx_date(&dt_raw)?;

        let amt_raw = extract_ofx_tag(block, "TRNAMT").ok_or_else(|| {
            format!(
                "OFX transaction on {} is missing a <TRNAMT> amount tag.",
                posted_date
            )
        })?;
        let amount_cents = parse_amount_to_cents(&amt_raw)?;

        let name = extract_ofx_tag(block, "NAME").or_else(|| extract_ofx_tag(block, "PAYEE"));
        let memo_tag = extract_ofx_tag(block, "MEMO");
        let check_num = extract_ofx_tag(block, "CHECKNUM");

        let payee = match (&name, &memo_tag, &check_num) {
            (Some(n), _, _) => n.clone(),
            (None, Some(m), _) => m.clone(),
            (None, None, Some(chk)) => format!("Check #{}", chk),
            (None, None, None) => "Bank transaction".to_string(),
        };

        let mut memo = memo_tag.unwrap_or_default();
        if let Some(chk) = check_num {
            if !payee.contains(&chk) {
                memo = if memo.is_empty() {
                    format!("Check #{}", chk)
                } else {
                    format!("Check #{} - {}", chk, memo)
                };
            }
        }

        let external_id = extract_ofx_tag(block, "FITID");

        rows.push(ParsedRow {
            posted_date,
            payee,
            memo,
            amount_cents,
            external_id,
            category_hint: None,
        });
    }

    if rows.is_empty() {
        return Err(
            "No <STMTTRN> transactions were found in this OFX/QFX statement.".to_string(),
        );
    }

    Ok(ParsedStatement {
        format: "ofx".to_string(),
        rows,
        statement_balance_cents,
        csv_headers: None,
        inferred_csv_mapping: None,
        warnings,
    })
}
