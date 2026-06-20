use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use futures::{SinkExt, StreamExt};
use solana_sdk::signature::Signature;
use std::collections::HashMap;
use std::str::FromStr;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use tracing::{info, warn};

pub use yellowstone_grpc_client::GeyserGrpcClient;

pub use yellowstone_grpc_proto::prelude::{
    subscribe_update::UpdateOneof,
    CommitmentLevel,
    SubscribeRequest,
    SubscribeRequestFilterTransactions,
    SubscribeRequestPing,
};

#[derive(Debug, Clone)]
pub struct StreamTxStatus {
    #[allow(dead_code)]
    pub signature: String,
    pub slot: u64,
    #[allow(dead_code)]
    pub observed_at: DateTime<Utc>,
    pub err: Option<String>,
}

/// Watch for a transaction WHILE it is being submitted.
/// `ready_tx` fires once the stream is open so the caller can submit the bundle.
pub async fn watch_transaction_status_with_ready(
    endpoint: String,
    token: String,
    signature: String,
    timeout_secs: u64,
    ready_tx: oneshot::Sender<()>,
) -> Result<Option<StreamTxStatus>> {
    let parsed_signature = Signature::from_str(&signature)
        .with_context(|| format!("parse signature: {}", signature))?;

    let wallet_pubkey = std::env::var("WALLET_PUBKEY").unwrap_or_default();

    info!("Yellowstone transaction-status watch starting for {}", signature);

    let watch = async move {
        let tls_config = tonic::transport::ClientTlsConfig::new().with_webpki_roots();
        let mut client = GeyserGrpcClient::build_from_shared(endpoint)?
            .x_token(Some(token))?
            .tls_config(tls_config)?
            .connect()
            .await?;

        let mut transactions = HashMap::new();
        transactions.insert(
            "smart_tx_observatory".to_string(),
            SubscribeRequestFilterTransactions {
                vote: Some(false),
                failed: Some(false),
                signature: None,
                account_include: if wallet_pubkey.is_empty() {
                    vec![]
                } else {
                    vec![wallet_pubkey]
                },
                account_exclude: vec![],
                account_required: vec![],
            },
        );

        let request = SubscribeRequest {
            transactions,
            commitment: Some(CommitmentLevel::Confirmed as i32),
            ..Default::default()
        };

        let (mut sink, mut stream) = client.subscribe_with_request(Some(request)).await?;
        info!("Yellowstone transaction-status stream active");

        // Signal caller that stream is ready — they can now submit the bundle
        let _ = ready_tx.send(());

        while let Some(message) = stream.next().await {
            let msg = message?;
            match msg.update_oneof {
                Some(UpdateOneof::Transaction(tx_update)) => {
                    if let Some(tx_info) = tx_update.transaction {
                        if let Ok(observed_sig) = Signature::try_from(tx_info.signature.as_slice()) {
                            if observed_sig == parsed_signature {
                                let err = tx_info.meta
                                    .and_then(|m| m.err)
                                    .map(|e| format!("{:?}", e));
                                info!(
                                    "Yellowstone observed transaction: sig={} slot={} err={:?}",
                                    observed_sig, tx_update.slot, err
                                );
                                return Ok(Some(StreamTxStatus {
                                    signature: observed_sig.to_string(),
                                    slot: tx_update.slot,
                                    observed_at: Utc::now(),
                                    err,
                                }));
                            }
                        }
                    }
                }
                Some(UpdateOneof::Ping(_)) => {
                    let _ = sink.send(SubscribeRequest {
                        ping: Some(SubscribeRequestPing { id: 1 }),
                        ..Default::default()
                    }).await;
                }
                _ => {}
            }
        }

        Ok(None)
    };

    match timeout(Duration::from_secs(timeout_secs), watch).await {
        Ok(result) => result,
        Err(_) => {
            warn!(
                "Yellowstone transaction-status watch timed out for {} after {}s",
                signature, timeout_secs
            );
            Ok(None)
        }
    }
}

// Kept for backward compatibility with lifecycle.rs
#[allow(dead_code)]
pub async fn watch_transaction_status(
    endpoint: String,
    token: String,
    signature: String,
    timeout_secs: u64,
) -> Result<Option<StreamTxStatus>> {
    let (ready_tx, _ready_rx) = oneshot::channel();
    watch_transaction_status_with_ready(endpoint, token, signature, timeout_secs, ready_tx).await
}
