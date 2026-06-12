mod config;
mod geyser;
mod jito;
mod lifecycle;

use anyhow::Result;
use solana_sdk::signature::{Keypair, Signer};
use tracing::{info, error};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    info!("Starting Smart Transaction Observatory Engine...");

    // Load config from .env
    let config = config::Config::from_env()?;
    info!("Config loaded.");

    // Parse the wallet keypair
    let wallet_bytes: Vec<u8> = serde_json::from_str(&config.wallet_private_key)
        .expect("WALLET_PRIVATE_KEY must be a JSON array of bytes, e.g. [1,2,3,...]");
    let keypair = Keypair::try_from(wallet_bytes.as_slice())
        .expect("Invalid keypair bytes");
    info!("Wallet: {}", keypair.pubkey());

    // Check wallet balance
    let rpc_client = solana_rpc_client::rpc_client::RpcClient::new(config.solana_rpc_url.clone());
    let balance = rpc_client.get_balance(&keypair.pubkey())?;
    info!("Wallet balance: {} lamports ({:.6} SOL)", balance, balance as f64 / 1e9);

    if balance < 50_000 {
        anyhow::bail!("Wallet balance too low for bundle submissions. Need at least 50,000 lamports.");
    }

    // Clean stale lifecycle log from previous runs
    let log_path = std::path::Path::new("lifecycle_log.jsonl");
    if log_path.exists() {
        info!("Removing stale lifecycle_log.jsonl from previous run");
        std::fs::remove_file(log_path).ok();
    }

    // Run bundle submissions
    info!("===============================================");
    info!("  Phase: Jito Bundle Submission");
    info!("===============================================");

    let total_runs: u32 = 12; // 10 normal + 2 intentional failures

    for run_num in 1..=total_runs {
        info!("---------------------------------------------");
        info!("Bundle Run {}/{}", run_num, total_runs);
        info!("---------------------------------------------");

        // Determine tip: runs 11 and 12 are intentional failures
        let (tip_lamports, memo_text) = match run_num {
            11 => {
                // Intentional failure: tip = 0 (below minimum, should be rejected)
                info!("INTENTIONAL FAILURE: tip = 0 lamports (below minimum)");
                (0u64, "Smart TX Observatory | FAIL TEST: zero tip")
            }
            12 => {
                // Intentional failure: we still send a valid tx but with a very old memo
                // to demonstrate failure logging (tip_lamports = 1, likely too low)
                info!("INTENTIONAL FAILURE: tip = 1 lamport (below floor)");
                (1u64, "Smart TX Observatory | FAIL TEST: micro tip")
            }
            _ => {
                // Normal run: get dynamic tip
                let tip = jito::get_dynamic_tip(&config.solana_rpc_url).await?;
                (tip, "Smart TX Observatory | bounty demo")
            }
        };

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
                // Track the bundle lifecycle (poll for confirmation)
                if run.status == lifecycle::BundleStatus::Submitted {
                    let bid = run.bundle_id.clone();
                    lifecycle::track_bundle(
                        &config.jito_block_engine_url,
                        &config.solana_rpc_url,
                        &bid,
                        &mut run,
                        10,    // max 10 polls
                        6000,  // every 6 seconds = 60s max wait
                    )
                    .await;
                }

                // Log to lifecycle file
                lifecycle::log_run(&run);

                info!(
                    "Run #{}: status={} bundle_id={} sig={}",
                    run.run_number, run.status, run.bundle_id, run.signature
                );
            }
            Err(e) => {
                error!("Run #{} failed to build/submit: {}", run_num, e);

                // Log the failure
                let fail_run = lifecycle::BundleRun {
                    bundle_id: String::new(),
                    signature: String::new(),
                    tip_lamports,
                    tip_account: String::new(),
                    status: lifecycle::BundleStatus::Failed,
                    submitted_at: chrono::Utc::now(),
                    landed_at: None,
                    error_reason: Some(format!("{:#}", e)),
                    run_number: run_num,
                };
                lifecycle::log_run(&fail_run);
            }
        }

        // Brief pause between bundles (reduce rate-limit pressure on Jito)
        if run_num < total_runs {
            info!("Waiting 8s before next bundle...");
            tokio::time::sleep(tokio::time::Duration::from_secs(8)).await;
        }
    }

    info!("===============================================");
    info!("  All {} bundle runs complete!", total_runs);
    info!("  See lifecycle_log.jsonl for full results.");
    info!("===============================================");

    Ok(())
}