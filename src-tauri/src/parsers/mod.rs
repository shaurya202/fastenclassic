pub mod csv_parser;
pub mod ofx_parser;
pub mod qif_parser;

use crate::models::CsvColumnMapping;
use chrono::{Datelike, NaiveDate};

#[derive(Debug, Clone)]
pub struct ParsedRow {
    pub posted_date: String,
    pub payee: String,
    pub memo: String,
    pub amount_cents: i64,
    pub external_id: Option<String>,
    pub category_hint: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedStatement {
    pub format: String,
    pub rows: Vec<ParsedRow>,
    pub statement_balance_cents: Option<i64>,
    pub csv_headers: Option<Vec<String>>,
    pub inferred_csv_mapping: Option<CsvColumnMapping>,
    pub warnings: Vec<String>,
}

pub fn detect_statement_format(file_name: &str, content: &str) -> String {
    let lower_name = file_name.trim().to_lowercase();
    if lower_name.ends_with(".ofx") || lower_name.ends_with(".qfx") {
        return "ofx".to_string();
    }
    if lower_name.ends_with(".qif") {
        return "qif".to_string();
    }
    if lower_name.ends_with(".csv") || lower_name.ends_with(".tsv") {
        return "csv".to_string();
    }

    let trimmed = content.trim_start_matches('\u{feff}').trim_start();
    let upper_head: String = trimmed.chars().take(512).collect::<String>().to_uppercase();
    if upper_head.contains("OFXHEADER:") || upper_head.contains("<OFX>") || upper_head.contains("<STMTTRN>") {
        return "ofx".to_string();
    }
    if trimmed.starts_with("!Type:") || trimmed.starts_with("!Account") || trimmed.starts_with("!Option:") {
        return "qif".to_string();
    }
    "csv".to_string()
}

pub fn parse_statement(
    file_name: &str,
    content: &str,
    format_override: Option<&str>,
    csv_mapping: Option<&CsvColumnMapping>,
) -> Result<ParsedStatement, String> {
    let clean = content.trim_start_matches('\u{feff}');
    if clean.trim().is_empty() {
        return Err("The selected statement file is empty. Choose a CSV, OFX/QFX, or QIF file with at least one transaction.".to_string());
    }

    let format = format_override
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| detect_statement_format(file_name, clean));

    match format.as_str() {
        "ofx" | "qfx" => ofx_parser::parse_ofx(clean),
        "qif" => qif_parser::parse_qif(clean),
        "csv" => csv_parser::parse_csv(clean, csv_mapping),
        other => Err(format!(
            "Unsupported statement format '{}'. Fasten Classic imports CSV, OFX/QFX, and QIF statements.",
            other
        )),
    }
}

/// Parses common consumer bank date formats into canonical `YYYY-MM-DD`.
pub fn parse_flexible_date(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return Err("Date value is blank.".to_string());
    }

    // Handle Quicken QIF apostrophe year notation: e.g. `10/15'26` or `10/15' 6`
    if let Some((md, yr)) = trimmed.split_once('\'') {
        let yr_clean = yr.trim().replace(' ', "0");
        let normalized = format!("{}/{}", md.trim(), yr_clean);
        return parse_flexible_date(&normalized);
    }

    // Strip ISO timestamps or OFX suffixes if passed: e.g. `2026-10-15T14:22:00Z`
    let date_part = if let Some((d, _)) = trimmed.split_once('T') {
        d
    } else if trimmed.len() >= 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-' {
        &trimmed[..10]
    } else {
        trimmed
    };

    let standard_formats = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%b %d, %Y",
        "%B %d, %Y",
        "%d %b %Y",
        "%d %B %Y",
        "%Y%m%d",
    ];

    for fmt in standard_formats {
        if let Ok(d) = NaiveDate::parse_from_str(date_part, fmt) {
            if d.year() >= 1900 {
                return Ok(d.format("%Y-%m-%d").to_string());
            }
        }
    }

    // Handle 1-or-2 digit month/day and 2-or-4 digit year separated by `/` or `-` or `.`
    let sep = if date_part.contains('/') {
        Some('/')
    } else if date_part.contains('-') {
        Some('-')
    } else if date_part.contains('.') {
        Some('.')
    } else {
        None
    };

    if let Some(ch) = sep {
        let parts: Vec<&str> = date_part.split(ch).map(|s| s.trim()).collect();
        if parts.len() == 3 {
            if let (Ok(p0), Ok(p1), Ok(p2)) = (
                parts[0].parse::<u32>(),
                parts[1].parse::<u32>(),
                parts[2].parse::<i32>(),
            ) {
                if parts[0].len() == 4 {
                    // YYYY/M/D
                    if let Some(d) = NaiveDate::from_ymd_opt(p0 as i32, p1, p2 as u32) {
                        return Ok(d.format("%Y-%m-%d").to_string());
                    }
                } else {
                    let year = if p2 < 100 {
                        if p2 >= 70 { 1900 + p2 } else { 2000 + p2 }
                    } else {
                        p2
                    };
                    // Prefer US M/D/Y unless first number > 12 (then D/M/Y)
                    let (month, day) = if p0 > 12 && p1 <= 12 {
                        (p1, p0)
                    } else {
                        (p0, p1)
                    };
                    if let Some(d) = NaiveDate::from_ymd_opt(year, month, day) {
                        return Ok(d.format("%Y-%m-%d").to_string());
                    }
                }
            }
        }
    }

    Err(format!(
        "Could not understand date '{}'. Expected a format like 2026-10-31 or 10/31/2026.",
        trimmed
    ))
}

/// Parses currency strings like `"-$1,234.56"`, `"($84.32)"`, `"120.5"`, `"+45.00"`, `"84,32"` into exact integer cents.
pub fn parse_amount_to_cents(raw: &str) -> Result<i64, String> {
    let mut s = raw.trim().trim_matches('"').trim().to_string();
    if s.is_empty() {
        return Err("Amount is blank.".to_string());
    }

    let mut negative = false;
    if s.starts_with('(') && s.ends_with(')') {
        negative = true;
        s = s[1..s.len() - 1].trim().to_string();
    }
    if s.to_uppercase().ends_with("DR") {
        negative = true;
        s = s[..s.len() - 2].trim().to_string();
    } else if s.to_uppercase().ends_with("CR") {
        s = s[..s.len() - 2].trim().to_string();
    }

    // Strip common currency symbols and whitespace
    s = s
        .replace(['$', '€', '£', '¥', ' '], "")
        .replace('\u{00a0}', "");

    if let Some(rest) = s.strip_prefix('-') {
        negative = !negative;
        s = rest.trim().to_string();
    } else if let Some(rest) = s.strip_prefix('+') {
        s = rest.trim().to_string();
    }
    if let Some(rest) = s.strip_suffix('-') {
        negative = !negative;
        s = rest.trim().to_string();
    }

    // Handle European vs US thousands/decimal separators
    let last_comma = s.rfind(',');
    let last_dot = s.rfind('.');
    let normalized = match (last_comma, last_dot) {
        (Some(c), Some(d)) if c > d => {
            // e.g. 1.234,56 -> 1234.56
            s.replace('.', "").replace(',', ".")
        }
        (Some(_), Some(_)) => {
            // e.g. 1,234.56 -> 1234.56
            s.replace(',', "")
        }
        (Some(c), None) => {
            let decimals = s.len() - c - 1;
            if decimals == 2 && s.matches(',').count() == 1 {
                s.replace(',', ".")
            } else {
                s.replace(',', "")
            }
        }
        _ => s,
    };

    if normalized.is_empty() {
        return Err(format!("Could not read an amount from '{}'.", raw));
    }

    let (whole_str, frac_str) = match normalized.split_once('.') {
        Some((w, f)) => (w, f),
        None => (normalized.as_str(), ""),
    };

    let whole: i64 = if whole_str.is_empty() {
        0
    } else {
        whole_str
            .parse::<i64>()
            .map_err(|_| format!("Could not read dollar amount '{}'.", raw))?
    };

    if !frac_str.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Could not read cents in amount '{}'.", raw));
    }

    let cents_part: i64 = match frac_str.len() {
        0 => 0,
        1 => frac_str.parse::<i64>().unwrap_or(0) * 10,
        2 => frac_str.parse::<i64>().unwrap_or(0),
        _ => {
            // Round to nearest cent using 3rd digit
            let two = frac_str[..2].parse::<i64>().unwrap_or(0);
            let third = frac_str.as_bytes()[2] - b'0';
            if third >= 5 { two + 1 } else { two }
        }
    };

    let total = whole
        .checked_mul(100)
        .and_then(|v| v.checked_add(cents_part))
        .ok_or_else(|| format!("Amount '{}' is out of supported range.", raw))?;

    Ok(if negative { -total } else { total })
}
