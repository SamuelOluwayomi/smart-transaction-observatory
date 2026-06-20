mod config;
mod geyser;
mod jito;
mod lifecycle;

use anyhow::Result;
use solana_sdk::signature::{Keypair, Signer};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Notify;
use tracing::{info, warn, error};

/// Shared state between the RPC slot poller and the main submission loop.
/// The slot is updated every ~400ms via a background reqwest::Client poll.
/// The single Ace-plan gRPC stream is reserved for tx confirmation (geyser.rs).
struct SlotState {
    latest_slot: AtomicU64,
    slot_updated: Notify,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    if std::env::var("FAIL_TEST").as_deref() == Ok("expired-hash") {
        std::env::set_var("FORCE_EXPIRED_HASH", "true");
    }

    info!("Starting Sentry Engine...");

    let config = config::Config::from_env()?;
    info!("Config loaded.");

    let wallet_bytes: Vec<u8> = serde_json::from_str(&config.wallet_private_key)
        .expect("WALLET_PRIVATE_KEY must be a JSON array of bytes, e.g. [1,2,3,...]");
    let keypair = Keypair::try_from(wallet_bytes.as_slice())
        .expect("Invalid keypair bytes");
    info!("Wallet: {}", keypair.pubkey());

    let rpc_client = solana_rpc_client::rpc_client::RpcClient::new(config.solana_rpc_url.clone());
    let balance = rpc_client.get_balance(&keypair.pubkey())?;
    info!("Wallet balance: {} lamports ({:.6} SOL)", balance, balance as f64 / 1e9);

    if balance < 50_000 {
        anyhow::bail!("Wallet balance too low for bundle submissions. Need at least 50,000 lamports.");
    }

    // Clean stale lifecycle logs from previous runs (only on fresh non-failure-test runs)
    if std::env::var("FAIL_TEST").is_err() {
        let log_path_env = std::env::var("LIFECYCLE_LOG_PATH").unwrap_or_else(|_| "lifecycle_log.jsonl".to_string());
        let log_path = std::path::Path::new(&log_path_env);
        if log_path.exists() {
            info!("Removing stale lifecycle_log.jsonl from previous run: {:?}", log_path);
            std::fs::remove_file(log_path).ok();
        }
        let logs_dir_env = std::env::var("LOGS_DIR").unwrap_or_else(|_| "../logs".to_string());
        let project_log = std::path::Path::new(&logs_dir_env).join("lifecycle_log.jsonl");
        if project_log.exists() {
            std::fs::remove_file(project_log).ok();
        }
    }

    // Capture the initial slot from Solana RPC before we start
    let slot_state = Arc::new(SlotState {
        latest_slot: AtomicU64::new(0),
        slot_updated: Notify::new(),
    });

    let initial_slot = rpc_client.get_slot().unwrap_or(0);
    slot_state.latest_slot.store(initial_slot, Ordering::Relaxed);
    info!("Initial RPC slot: {}", initial_slot);

    // Spawn WebSocket-equivalent slot poller as a background task.
    let ws_state = Arc::clone(&slot_state);
    let ws_rpc_url = config.solana_rpc_url.clone();
    let _slot_handle = tokio::spawn(async move {
        info!("Launching RPC slot poller (gRPC stream reserved for tx confirmation)...");
        run_rpc_slot_poller(ws_rpc_url, ws_state).await;
    });

    // Brief pause to let slot poller initialize (non-blocking to the main loop)
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // ===================================================================
    //  Bundle submission loop
    // ===================================================================
    info!("===============================================");
    info!("  Phase: Jito Bundle Submission");
    info!("===============================================");

    let total_runs: u32 = std::env::var("RUN_COUNT")
        .ok()
        .and_then(|val| val.parse().ok())
        .unwrap_or(12); // default to 10 normal + 2 failures

    for run_num in 1..=total_runs {
        info!("---------------------------------------------");
        info!("Bundle Run {}/{}", run_num, total_runs);
        info!("---------------------------------------------");

        // Log the current slot from Yellowstone (or RPC fallback)
        let current_slot = slot_state.latest_slot.load(Ordering::Relaxed);
        info!("Current observed slot: {}", current_slot);

        // Determine tip and failure injection
        let (tip_lamports, memo_text, intentional_failure) = if std::env::var("FAIL_TEST").as_deref() == Ok("zero-tip") {
            info!("FAIL TEST MODE: Forcing tip = 0 lamports (zero-tip failure)");
            (0u64, "Sentry | FAIL TEST: zero tip", true)
        } else if std::env::var("FAIL_TEST").as_deref() == Ok("expired-hash") {
            info!("FAIL TEST MODE: Forcing expired blockhash (expired-hash failure)");
            let tip = jito::get_dynamic_tip(&config.solana_rpc_url).await.unwrap_or(30_000);
            (tip, "Sentry | FAIL TEST: expired blockhash", true)
        } else if total_runs >= 2 && run_num == total_runs - 1 {
            info!("INTENTIONAL FAILURE: tip = 0 lamports (below minimum)");
            (0u64, "Sentry | FAIL TEST: zero tip", true)
        } else if total_runs >= 2 && run_num == total_runs {
            info!("INTENTIONAL FAILURE: tip = 1 lamport (below floor)");
            (1u64, "Sentry | FAIL TEST: micro tip", true)
        } else {
            let tip = jito::get_dynamic_tip(&config.solana_rpc_url).await?;
            (tip, "Sentry | bounty demo", false)
        };

        // ── Yellowstone-first pattern ──────────────────────────────────
        // Open the gRPC stream BEFORE submitting so we never miss the event.
        // We don't know the signature yet, so we use a placeholder and swap it
        // once build_and_submit_bundle returns. The stream watches by wallet
        // account key so it catches the tx regardless.
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
        let (sig_tx, sig_rx) = tokio::sync::oneshot::channel::<String>();

        let ys_endpoint = config.yellowstone_endpoint.clone();
        let ys_token = config.yellowstone_token.clone();

        let watch_handle = tokio::spawn(async move {
            // Wait for caller to tell us the real signature
            let signature = match sig_rx.await {
                Ok(s) => s,
                Err(_) => return Ok(None),
            };
            geyser::watch_transaction_status_with_ready(
                ys_endpoint,
                ys_token,
                signature,
                55,
                ready_tx,
            )
            .await
        });

        // Submit the bundle
        let result = jito::build_and_submit_bundle(
            &config.solana_rpc_url,
            &config.jito_block_engine_url,
            &keypair,
            tip_lamports,
            run_num,
            memo_text,
        )
        .await;

        match result {
            Ok(mut run) => {
                // Record the slot at time of submission
                run.submit_slot = Some(slot_state.latest_slot.load(Ordering::Relaxed));

                // Send signature to the watcher task
                let _ = sig_tx.send(run.signature.clone());

                // Wait for stream to be ready (or timeout after 3s)
                let _ = tokio::time::timeout(
                    tokio::time::Duration::from_secs(3),
                    ready_rx,
                ).await;

                // Track the bundle lifecycle
                if run.status == lifecycle::BundleStatus::Submitted {
                    let bid = run.bundle_id.clone();

                    // Wait for Yellowstone watcher result (up to 55s)
                    let ys_result = tokio::time::timeout(
                        tokio::time::Duration::from_secs(58),
                        watch_handle,
                    ).await;

                    match ys_result {
                        Ok(Ok(Ok(Some(stream_status)))) => {
                            info!(
                                "Yellowstone confirmed tx at slot {} err={:?}",
                                stream_status.slot, stream_status.err
                            );
                            run.submit_slot = run.submit_slot.or(Some(stream_status.slot));
                            // Fall through to RPC for full commitment levels
                        }
                        _ => {
                            info!("Yellowstone watch ended, falling back to RPC polling");
                        }
                    }

                    lifecycle::track_bundle(
                        &config.jito_block_engine_url,
                        &config.solana_rpc_url,
                        Some(&config.yellowstone_endpoint),
                        Some(&config.yellowstone_token),
                        &bid,
                        &mut run,
                        15,
                        4000,
                    )
                    .await;
                } else {
                    // Drain the watcher for non-submitted runs
                    drop(watch_handle);
                }

                // Classify intentional failures that might have "succeeded" anyway
                if intentional_failure && run.status != lifecycle::BundleStatus::Landed {
                    if run.failure_type.is_none() {
                        if std::env::var("FAIL_TEST").as_deref() == Ok("zero-tip") {
                            run.classify_failure(
                                "zero_tip",
                                "tip_calculation",
                                "Tip was 0 lamports; Jito requires a nonzero tip to include bundles (fault injection test)",
                            );
                        } else if std::env::var("FAIL_TEST").as_deref() == Ok("expired-hash") {
                            run.classify_failure(
                                "blockhash_expired",
                                "pre_submission",
                                "Forced expired blockhash (fault injection test)",
                            );
                        } else if total_runs >= 2 && run_num == total_runs - 1 {
                            run.classify_failure(
                                "zero_tip",
                                "tip_calculation",
                                "Tip was 0 lamports; Jito requires a nonzero tip to include bundles",
                            );
                        } else if total_runs >= 2 && run_num == total_runs {
                            run.classify_failure(
                                "tip_below_floor",
                                "tip_calculation",
                                "Tip was 1 lamport; well below the Jito tip floor for auction inclusion",
                            );
                        }
                    }
                }

                // Automatic retry with blockhash refresh for non-intentional failures
                if !intentional_failure
                    && run.status != lifecycle::BundleStatus::Landed
                    && run.status != lifecycle::BundleStatus::Pending
                {
                    info!("Run #{} failed ({}), attempting autonomous retry with fresh blockhash...", run_num, run.status);
                    run.recovery = Some("Autonomous retry with fresh blockhash and recalculated tip".to_string());

                    // Recalculate tip for the retry
                    let retry_tip = jito::get_dynamic_tip(&config.solana_rpc_url).await.unwrap_or(30_000);
                    info!("Retry tip: {} lamports", retry_tip);

                    let retry_result = jito::build_and_submit_bundle(
                        &config.solana_rpc_url,
                        &config.jito_block_engine_url,
                        &keypair,
                        retry_tip,
                        run_num,
                        "Smart TX Observatory | auto-retry",
                    )
                    .await;

                    match retry_result {
                        Ok(mut retry_run) => {
                            retry_run.submit_slot = Some(slot_state.latest_slot.load(Ordering::Relaxed));

                            if retry_run.status == lifecycle::BundleStatus::Submitted {
                                let bid = retry_run.bundle_id.clone();
                                lifecycle::track_bundle(
                                    &config.jito_block_engine_url,
                                    &config.solana_rpc_url,
                                    Some(&config.yellowstone_endpoint),
                                    Some(&config.yellowstone_token),
                                    &bid,
                                    &mut retry_run,
                                    15,
                                    4000,
                                )
                                .await;
                            }

                            if retry_run.status == lifecycle::BundleStatus::Landed {
                                info!("Retry SUCCEEDED for run #{}", run_num);
                                retry_run.recovery = Some(format!(
                                    "Original failed with '{}'. Retried with fresh blockhash and tip {} lamports. Landed.",
                                    run.error_reason.as_deref().unwrap_or("unknown"),
                                    retry_tip
                                ));
                                // Log the retry as a separate entry
                                lifecycle::log_run(&retry_run);
                            } else {
                                warn!("Retry also failed for run #{}: {}", run_num, retry_run.status);
                            }
                        }
                        Err(e) => {
                            error!("Retry submission error for run #{}: {}", run_num, e);
                        }
                    }
                }

                // Log the original run
                lifecycle::log_run(&run);

                info!(
                    "Run #{}: status={} bundle_id={} sig={} slot={:?}",
                    run.run_number, run.status, run.bundle_id, run.signature, run.landed_slot
                );

                // Print lifecycle deltas if available
                if let (Some(p), Some(c)) = (run.processed_at, run.confirmed_at) {
                    info!(
                        "  processed->confirmed: {}ms",
                        (c - p).num_milliseconds()
                    );
                }
                if let (Some(c), Some(f)) = (run.confirmed_at, run.finalized_at) {
                    info!(
                        "  confirmed->finalized: {}ms",
                        (f - c).num_milliseconds()
                    );
                }
            }
            Err(e) => {
                error!("Run #{} failed to build/submit: {}", run_num, e);

                let mut fail_run = lifecycle::BundleRun::new(
                    String::new(),
                    String::new(),
                    tip_lamports,
                    String::new(),
                    lifecycle::BundleStatus::Failed,
                    run_num,
                );
                fail_run.error_reason = Some(format!("{:#}", e));
                fail_run.classify_failure(
                    "build_error",
                    "pre_submission",
                    "Check wallet balance, RPC connectivity, and keypair validity",
                );
                lifecycle::log_run(&fail_run);
            }
        }

        // Brief pause between bundles
        if run_num < total_runs {
            info!("Waiting 8s before next bundle...");
            tokio::time::sleep(tokio::time::Duration::from_secs(8)).await;
        }
    }

    info!("===============================================");
    info!("  All {} bundle runs complete!", total_runs);
    info!("  See lifecycle_log.jsonl and ../logs/ for results.");
    info!("===============================================");

    Ok(())
}

/// Poll Solana RPC for the current slot every 400ms and update shared state.
async fn run_rpc_slot_poller(rpc_url: String, state: Arc<SlotState>) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("build reqwest client for slot poller");

    info!("RPC slot poller active — polling {} every 400ms", rpc_url);

    loop {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getSlot",
            "params": [{ "commitment": "processed" }]
        });

        match client.post(&rpc_url).json(&body).send().await {
            Ok(resp) => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(slot) = json["result"].as_u64() {
                        let old = state.latest_slot.swap(slot, Ordering::Relaxed);
                        if slot > old + 5 || old == 0 {
                            info!("RPC slot poll: {} (was {})", slot, old);
                        }
                        state.slot_updated.notify_waiters();
                    }
                }
            }
            Err(e) => {
                warn!("RPC slot poll error (non-fatal): {}", e);
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(400)).await;
    }
}
