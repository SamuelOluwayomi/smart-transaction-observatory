#[allow(deprecated)]
use anyhow::{Context, Result};
use base64::Engine as _;
use chrono::Utc;
use rand::seq::SliceRandom;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    message::Message,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::Transaction,
};
use solana_rpc_client::rpc_client::RpcClient;
use tracing::{info, warn, error};

use crate::lifecycle::{BundleRun, BundleStatus};

/// Hardcoded Jito tip accounts.
const JITO_TIP_ACCOUNTS: &[&str] = &[
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
];

/// SPL Memo program ID.
const MEMO_PROGRAM_ID: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
pub async fn build_and_submit_bundle(
    rpc_url: &str,
    jito_url: &str,
    keypair: &Keypair,
    tip_lamports: u64,
    run_number: u32,
    memo_text: &str,
) -> Result<BundleRun> {
    let rpc_client = RpcClient::new(rpc_url.to_string());
    let http_client = reqwest::Client::new();
    let jito_bundles_url = format!("{}/api/v1/bundles", jito_url.trim_end_matches('/'));

    // 1. Fetch current tip accounts from Jito (not hardcoded -- they can rotate)
    let tip_accounts_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTipAccounts",
        "params": []
    });

    let tip_resp = http_client
        .post(&jito_bundles_url)
        .json(&tip_accounts_body)
        .send()
        .await
        .context("POST getTipAccounts")?;

    let tip_json: serde_json::Value = tip_resp.json().await.context("parse getTipAccounts")?;
    info!("getTipAccounts response: {}", tip_json);

    let tip_accounts: Vec<String> = tip_json
        .get("result")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    if tip_accounts.is_empty() {
        // Fallback to hardcoded if getTipAccounts fails
        warn!("getTipAccounts returned empty, using hardcoded fallback");
    }

    let active_tip_accounts: Vec<&str> = if tip_accounts.is_empty() {
        JITO_TIP_ACCOUNTS.to_vec()
    } else {
        tip_accounts.iter().map(|s| s.as_str()).collect()
    };

    let mut rng = rand::thread_rng();
    let tip_account_str = active_tip_accounts
        .choose(&mut rng)
        .expect("tip accounts not empty");
    let tip_account_pubkey = tip_account_str.parse::<Pubkey>()
        .context("parse tip account pubkey")?;

    info!("Tip account: {} | Tip: {} lamports", tip_account_str, tip_lamports);

    // 2. Build instructions
    let memo_program_id = MEMO_PROGRAM_ID.parse::<Pubkey>()
        .context("parse memo program ID")?;

    let memo_ix = Instruction {
        program_id: memo_program_id,
        accounts: vec![AccountMeta::new_readonly(keypair.pubkey(), true)],
        data: memo_text.as_bytes().to_vec(),
    };

    let tip_ix = system_instruction::transfer(
        &keypair.pubkey(),
        &tip_account_pubkey,
        tip_lamports,
    );

    // 3. Simulate via Solana RPC (validates instruction logic)
    let sim_blockhash = rpc_client
        .get_latest_blockhash()
        .context("fetch blockhash for simulation")?;

    let sim_message = Message::new(&[memo_ix.clone(), tip_ix.clone()], Some(&keypair.pubkey()));
    let sim_tx = Transaction::new(&[keypair], sim_message, sim_blockhash);

    match rpc_client.simulate_transaction(&sim_tx) {
        Ok(sim_result) => {
            if let Some(err) = &sim_result.value.err {
                error!("Transaction simulation FAILED: {:?}", err);
                if let Some(logs) = &sim_result.value.logs {
                    for log in logs {
                        error!("  sim log: {}", log);
                    }
                }
                let mut fail_run = BundleRun::new(
                    String::new(),
                    sim_tx.signatures[0].to_string(),
                    tip_lamports,
                    tip_account_str.to_string(),
                    BundleStatus::Failed,
                    run_number,
                );
                fail_run.error_reason = Some(format!("Simulation failed: {:?}", err));
                fail_run.classify_failure(
                    "simulation_failure",
                    "pre_submission",
                    "Check instruction logic, account balances, and compute budget",
                );
                return Ok(fail_run);
            }
            info!("Solana simulation OK ({} CUs used)", sim_result.value.units_consumed.unwrap_or(0));
        }
        Err(e) => {
            warn!("Simulation RPC error (non-fatal, proceeding): {}", e);
        }
    }

    // 4. Fetch FRESH blockhash, build final tx, serialize
    let recent_blockhash = rpc_client
        .get_latest_blockhash()
        .context("fetch fresh blockhash for submission")?;

    let message = Message::new(&[memo_ix, tip_ix], Some(&keypair.pubkey()));
    let tx = Transaction::new(&[keypair], message, recent_blockhash);

    let signature = tx.signatures[0].to_string();
    info!("Signature: {}", signature);

    let tx_bytes = bincode::serialize(&tx).context("serialize transaction")?;
    let tx_base64 = base64::engine::general_purpose::STANDARD.encode(&tx_bytes);

    // 5. Send via Jito sendTransaction (/api/v1/transactions)
    //    This is simpler than sendBundle and also creates a bundle internally.
    //    The bundle_id is returned in the x-bundle-id response header.
    let send_tx_url = format!("{}/api/v1/transactions", jito_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "sendTransaction",
        "params": [tx_base64, {"encoding": "base64"}]
    });

    info!("Submitting transaction to Jito via sendTransaction...");

    let max_retries = 4;
    let mut last_error_msg = String::new();
    let mut submitted = false;
    let mut resp_json = serde_json::Value::Null;

    for attempt in 1..=max_retries {
        let resp = http_client
            .post(&send_tx_url)
            .json(&body)
            .send()
            .await
            .context("POST sendTransaction")?;

        let status = resp.status();
        // Capture the x-bundle-id header before consuming the body
        let bundle_id_header = resp.headers()
            .get("x-bundle-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let resp_text = resp.text().await.context("read sendTransaction response body")?;
        info!("Jito HTTP {} (attempt {}/{}): {}", status, attempt, max_retries, resp_text);
        if let Some(ref bid) = bundle_id_header {
            info!("x-bundle-id header: {}", bid);
        }

        let parsed: serde_json::Value = serde_json::from_str(&resp_text)
            .with_context(|| format!("parse sendTransaction JSON (status={}): {}", status, resp_text))?;

        // Check for rate limit error (code -32097 or HTTP 429)
        if let Some(error) = parsed.get("error") {
            let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            let msg = error.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");

            if code == -32097 || status.as_u16() == 429 {
                // Rate limited -- retry with backoff
                let backoff_secs = 2u64 * attempt as u64; // 2s, 4s, 6s, 8s
                info!("Rate limited (code {}), retrying in {}s... (attempt {}/{})", code, backoff_secs, attempt, max_retries);
                last_error_msg = msg.to_string();
                tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs)).await;
                continue;
            }

            // Non-rate-limit error -- genuine rejection
            last_error_msg = msg.to_string();
            error!("Transaction rejected by Jito: {}", last_error_msg);

            let mut fail_run = BundleRun::new(
                bundle_id_header.unwrap_or_default(),
                signature,
                tip_lamports,
                tip_account_str.to_string(),
                BundleStatus::Invalid,
                run_number,
            );
            fail_run.error_reason = Some(last_error_msg);
            fail_run.classify_failure(
                "jito_rejection",
                "submission",
                "Transaction rejected by Jito block engine",
            );
            return Ok(fail_run);
        }

        // Success -- for sendTransaction, result is the tx signature (like Solana RPC)
        // The bundle_id comes from the x-bundle-id header
        resp_json = parsed;
        submitted = true;

        // Use x-bundle-id header if available, otherwise use "result" from JSON
        if let Some(bid) = bundle_id_header {
            // Store the bundle_id from the header in resp_json for later extraction
            resp_json["_bundle_id"] = serde_json::Value::String(bid);
        }
        break;
    }

    if !submitted {
        error!("Transaction submission failed after {} retries: {}", max_retries, last_error_msg);
        let mut fail_run = BundleRun::new(
            String::new(),
            signature,
            tip_lamports,
            tip_account_str.to_string(),
            BundleStatus::Invalid,
            run_number,
        );
        fail_run.error_reason = Some(format!("Rate limited after {} retries: {}", max_retries, last_error_msg));
        fail_run.classify_failure(
            "rate_limit_exhausted",
            "submission",
            "Increase backoff delay or reduce submission frequency",
        );
        return Ok(fail_run);
    }

    // For sendTransaction: result is the tx signature, bundle_id is from header
    let bundle_id = resp_json
        .get("_bundle_id")
        .or_else(|| resp_json.get("result"))
        .and_then(|r| r.as_str())
        .unwrap_or("unknown")
        .to_string();

    info!("Bundle ID: {}", bundle_id);

    Ok(BundleRun::new(
        bundle_id,
        signature,
        tip_lamports,
        tip_account_str.to_string(),
        BundleStatus::Submitted,
        run_number,
    ))
}

/// Fetch the dynamic tip floor based on Jito's Tip Floor API.
/// Returns the tip in lamports, floored at 30,000 lamports and capped at 100,000 lamports.
pub async fn get_dynamic_tip(_rpc_url: &str) -> Result<u64> {
    let client = reqwest::Client::new();
    
    match client.get("https://bundles.jito.wtf/api/v1/bundles/tip_floor").send().await {
        Ok(resp) => {
            match resp.json::<Vec<serde_json::Value>>().await {
                Ok(tip_data) => {
                    if let Some(first) = tip_data.first() {
                        if let Some(p75_sol) = first.get("landed_tips_75th_percentile").and_then(|v| v.as_f64()) {
                            let lamports = (p75_sol * 1_000_000_000.0) as u64;
                            let final_tip = lamports.max(30_000).min(100_000);
                            info!("Dynamic tip: {} lamports (Jito 75th percentile: {} lamports)", final_tip, lamports);
                            return Ok(final_tip);
                        }
                    }
                }
                Err(e) => {
                    info!("Failed to parse Jito tip floor response: {}, using fallback", e);
                }
            }
        }
        Err(e) => {
            info!("Failed to query Jito tip floor API: {}, using fallback", e);
        }
    }
    
    info!("Using fallback tip: 30000 lamports");
    Ok(30_000)
}
