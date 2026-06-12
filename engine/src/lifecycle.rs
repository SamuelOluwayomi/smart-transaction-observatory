use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use tracing::{info, warn, error};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BundleStatus {
    Submitted,
    Pending,
    Landed,
    Failed,
    Invalid,
}

impl std::fmt::Display for BundleStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BundleStatus::Submitted => write!(f, "Submitted"),
            BundleStatus::Pending => write!(f, "Pending"),
            BundleStatus::Landed => write!(f, "Landed"),
            BundleStatus::Failed => write!(f, "Failed"),
            BundleStatus::Invalid => write!(f, "Invalid"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleRun {
    pub bundle_id: String,
    pub signature: String,
    pub tip_lamports: u64,
    pub tip_account: String,
    pub status: BundleStatus,
    pub submitted_at: DateTime<Utc>,
    pub landed_at: Option<DateTime<Utc>>,
    pub error_reason: Option<String>,
    pub run_number: u32,
}

const LOG_FILE: &str = "lifecycle_log.jsonl";

/// Append a bundle run to the lifecycle log file.
pub fn log_run(run: &BundleRun) {
    let json = serde_json::to_string(run).expect("serialize BundleRun");

    let path = Path::new(LOG_FILE);
    match OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{}", json) {
                error!("Failed to write lifecycle log: {}", e);
            } else {
                info!("Logged run #{} -> {} | status={}", run.run_number, run.bundle_id, run.status);
            }
        }
        Err(e) => {
            error!("Failed to open lifecycle log file: {}", e);
        }
    }
}

/// Poll getBundleStatuses and Solana RPC signature status until the bundle lands, fails, or times out.
pub async fn track_bundle(
    jito_url: &str,
    rpc_url: &str,
    bundle_id: &str,
    run: &mut BundleRun,
    max_polls: u32,
    poll_interval_ms: u64,
) {
    let client = reqwest::Client::new();

    let rpc_client = solana_rpc_client::rpc_client::RpcClient::new(rpc_url.to_string());

    for attempt in 1..=max_polls {
        tokio::time::sleep(tokio::time::Duration::from_millis(poll_interval_ms)).await;

        // 1. First check Solana RPC for transaction confirmation status
        if let Ok(sig) = run.signature.parse::<solana_sdk::signature::Signature>() {
            match rpc_client.get_signature_statuses(&[sig]) {
                Ok(response) => {
                    if let Some(Some(status)) = response.value.into_iter().next() {
                        if status.err.is_none() {
                            if let Some(conf_status) = status.confirmation_status {
                                info!(
                                    "Bundle transaction landed on-chain (Solana RPC: {:?}) (poll {}/{})",
                                    conf_status, attempt, max_polls
                                );
                                run.status = BundleStatus::Landed;
                                run.landed_at = Some(Utc::now());
                                return;
                            }
                        } else {
                            error!(
                                "Bundle transaction failed on-chain: {:?} (poll {}/{})",
                                status.err, attempt, max_polls
                            );
                            run.status = BundleStatus::Failed;
                            run.error_reason = Some(format!("Transaction failed on-chain: {:?}", status.err));
                            return;
                        }
                    } else {
                        info!("Solana RPC: signature not on-chain yet (poll {}/{})", attempt, max_polls);
                    }
                }
                Err(e) => {
                    warn!("Solana RPC get_signature_statuses error: {} (poll {}/{})", e, attempt, max_polls);
                }
            }
        }

        // 2. If not landed on Solana RPC yet, query Jito inflight status
        // getInflightBundleStatuses tracks bundles within the last 5 minutes
        let inflight_url = format!("{}/api/v1/getInflightBundleStatuses", jito_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getInflightBundleStatuses",
            "params": [[bundle_id]]
        });

        match client.post(&inflight_url).json(&body).send().await {
            Ok(resp) => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    info!("Jito inflight raw response (poll {}/{}): {}", attempt, max_polls, json);
                    if let Some(result) = json.get("result") {
                        if let Some(value) = result.get("value") {
                            if let Some(arr) = value.as_array() {
                                if let Some(status_obj) = arr.first() {
                                    let bundle_status = status_obj
                                        .get("status")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("");

                                    match bundle_status {
                                        "Landed" => {
                                            info!(
                                                "Bundle {} -> Landed (getInflightBundleStatuses, poll {}/{})",
                                                bundle_id, attempt, max_polls
                                            );
                                            run.status = BundleStatus::Landed;
                                            run.landed_at = Some(Utc::now());
                                            return;
                                        }
                                        "Failed" => {
                                            error!(
                                                "Bundle {} -> Failed (getInflightBundleStatuses, poll {}/{})",
                                                bundle_id, attempt, max_polls
                                            );
                                            run.status = BundleStatus::Failed;
                                            run.error_reason = Some("Jito marked bundle as Failed".to_string());
                                            return;
                                        }
                                        "Invalid" => {
                                            warn!(
                                                "Bundle {} -> Invalid (not in Jito system, poll {}/{})",
                                                bundle_id, attempt, max_polls
                                            );
                                            // Invalid means it expired from the 5-min window; keep polling Solana RPC
                                        }
                                        "Pending" => {
                                            info!(
                                                "Bundle {} still Pending in Jito (poll {}/{})",
                                                bundle_id, attempt, max_polls
                                            );
                                        }
                                        other => {
                                            warn!(
                                                "Bundle {} unknown status: {} (poll {}/{})",
                                                bundle_id, other, attempt, max_polls
                                            );
                                        }
                                    }
                                } else {
                                    info!(
                                        "Bundle {} not found in Jito inflight (poll {}/{})",
                                        bundle_id, attempt, max_polls
                                    );
                                }
                            }
                        }
                    } else if let Some(err) = json.get("error") {
                        let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
                        let message = err.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
                        warn!("getInflightBundleStatuses error code={}: {} (poll {}/{})", code, message, attempt, max_polls);
                        if code == -32097 {
                            info!("Jito rate limit hit, backing off 4s...");
                            tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;
                        }
                    }
                }
            }
            Err(e) => {
                warn!("HTTP error polling inflight bundle status: {}", e);
            }
        }
    }

    // Timed out
    if run.status == BundleStatus::Submitted || run.status == BundleStatus::Pending {
        info!("Bundle {} timed out after {} polls", bundle_id, max_polls);
        run.status = BundleStatus::Pending;
        run.error_reason = Some("Timed out waiting for confirmation".to_string());
    }
}
