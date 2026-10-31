use crate::models::{BackupBundle, BackupPayload};
use chrono::Utc;
use sha2::{Digest, Sha256};

pub const BACKUP_APP_ID: &str = "fasten-classic";
pub const BACKUP_SCHEMA_VERSION: u32 = 1;

pub fn compute_payload_sha256(payload: &BackupPayload) -> Result<String, String> {
    let canonical = serde_json::to_vec(payload)
        .map_err(|e| format!("Failed to serialize backup payload: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&canonical);
    Ok(hex::encode(hasher.finalize()))
}

pub fn create_backup_json(payload: BackupPayload) -> Result<String, String> {
    let sha256 = compute_payload_sha256(&payload)?;
    let bundle = BackupBundle {
        app: BACKUP_APP_ID.to_string(),
        schema_version: BACKUP_SCHEMA_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        sha256,
        payload,
    };
    serde_json::to_string_pretty(&bundle)
        .map_err(|e| format!("Failed to encode backup JSON: {}", e))
}

pub fn verify_and_parse_backup_json(raw_json: &str) -> Result<BackupBundle, String> {
    let clean = raw_json.trim_start_matches('\u{feff}').trim();
    if clean.is_empty() {
        return Err("The selected backup file is empty.".to_string());
    }
    let bundle: BackupBundle = serde_json::from_str(clean).map_err(|e| {
        format!(
            "Could not read this backup file. Make sure you selected a valid Fasten Classic (.fastenbackup.json) backup. ({})",
            e
        )
    })?;

    if bundle.app != BACKUP_APP_ID {
        return Err(format!(
            "Unrecognized backup format '{}' (expected '{}').",
            bundle.app, BACKUP_APP_ID
        ));
    }
    if bundle.schema_version == 0 || bundle.schema_version > BACKUP_SCHEMA_VERSION {
        return Err(format!(
            "Backup schema version {} is not supported by this version of Fasten Classic (supports up to v{}).",
            bundle.schema_version, BACKUP_SCHEMA_VERSION
        ));
    }

    let expected_hash = compute_payload_sha256(&bundle.payload)?;
    if !bundle.sha256.eq_ignore_ascii_case(&expected_hash) {
        return Err(
            "Backup integrity check failed: the file contents do not match its SHA-256 checksum and may have been truncated or modified."
                .to_string(),
        );
    }

    Ok(bundle)
}
