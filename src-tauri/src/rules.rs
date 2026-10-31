use crate::models::{Category, CategoryRule};

pub struct RuleMatch {
    pub category_id: String,
    pub rule_id: String,
    pub renamed_payee: Option<String>,
}

/// Evaluates priority-sorted categorization rules against `(payee, memo, account_id)`.
pub fn match_category_rule(
    rules: &[CategoryRule],
    payee: &str,
    memo: &str,
    account_id: &str,
) -> Option<RuleMatch> {
    let payee_lower = payee.trim().to_lowercase();
    let combined_lower = if memo.trim().is_empty() {
        payee_lower.clone()
    } else {
        format!("{} {}", payee_lower, memo.trim().to_lowercase())
    };

    for rule in rules {
        if let Some(ref rule_acc) = rule.account_id {
            if !rule_acc.is_empty() && rule_acc != account_id {
                continue;
            }
        }
        let pat = rule.pattern.trim().to_lowercase();
        if pat.is_empty() {
            continue;
        }
        let matched = match rule.match_type.as_str() {
            "exact" => payee_lower == pat || combined_lower == pat,
            "starts_with" => payee_lower.starts_with(&pat) || combined_lower.starts_with(&pat),
            _ => combined_lower.contains(&pat),
        };
        if matched {
            return Some(RuleMatch {
                category_id: rule.category_id.clone(),
                rule_id: rule.id.clone(),
                renamed_payee: rule
                    .rename_payee
                    .as_ref()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
            });
        }
    }
    None
}

/// Resolves a QIF category hint (e.g. `Groceries`, `Auto:Fuel`, or `[Savings]`) against existing categories.
pub fn resolve_category_hint(categories: &[Category], hint: &str) -> Option<String> {
    let trimmed = hint.trim();
    if trimmed.is_empty() {
        return None;
    }
    // `[Account Name]` in QIF represents an account transfer
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return categories
            .iter()
            .find(|c| c.kind == "transfer")
            .map(|c| c.id.clone());
    }

    let lower = trimmed.to_lowercase();
    let leaf = lower.rsplit(':').next().unwrap_or(&lower).trim();

    categories
        .iter()
        .find(|c| {
            let cname = c.name.to_lowercase();
            cname == lower || cname == leaf || cname.contains(leaf) || leaf.contains(&cname)
        })
        .map(|c| c.id.clone())
}
