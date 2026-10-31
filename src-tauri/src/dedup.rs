use sha2::{Digest, Sha256};

/// Normalizes a payee/description string for duplicate comparison (strips punctuation, collapses whitespace, lowercases).
pub fn normalize_payee_key(payee: &str) -> String {
    let mut out = String::with_capacity(payee.len());
    let mut prev_space = true;
    for ch in payee.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    out.trim().to_string()
}

/// Computes the base content signature for `(account_id, posted_date, amount_cents, original_payee)`.
pub fn compute_base_signature(
    account_id: &str,
    posted_date: &str,
    amount_cents: i64,
    payee: &str,
) -> String {
    let norm = normalize_payee_key(payee);
    let raw = format!("{}|{}|{}|{}", account_id, posted_date.trim(), amount_cents, norm);
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let digest = hasher.finalize();
    hex::encode(&digest[..12])
}

/// Computes the occurrence-indexed fingerprint (`<base_sig>#<occurrence_1_based>`).
pub fn compute_occurrence_fingerprint(
    account_id: &str,
    posted_date: &str,
    amount_cents: i64,
    payee: &str,
    occurrence: usize,
) -> String {
    let base = compute_base_signature(account_id, posted_date, amount_cents, payee);
    format!("{}#{}", base, occurrence.max(1))
}
