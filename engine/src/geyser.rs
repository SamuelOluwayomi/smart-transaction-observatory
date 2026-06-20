use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use futures::{SinkExt, StreamExt};
use solana_sdk::signature::Signature;
use std::collections::HashMap;
use std::str::FromStr;
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
    pub signature: String,
    pub slot: u64,
    pub observed_at: DateTime<Utc>,
    pub err: Option<String>,
}

pub async fn watch_transaction_status(
    endpoint: String,
    token: String,
    signature: String,
    timeout_secs: u64,
) -> Result<Option<StreamTxStatus>> {
    let parsed_signature = Signature::from_str(&signature)
        .with_context(|| format!("parse signature for Yellowstone watch: {}", signature))?;

    info!(
        "Yellowstone transaction-status watch starting for {}",
        signature
    );

    let signature_for_watch = signature.clone();
    let signature_for_timeout = signature.clone();

    let watch = async move {
        let tls_config = tonic::transport::ClientTlsConfig::new().with_webpki_roots();
        let mut client = GeyserGrpcClient::build_from_shared(endpoint)?
            .x_token(Some(token))?
            .tls_config(tls_config)?
            .connect()
            .await?;

        let mut transactions_status = HashMap::new();
        transactions_status.insert(
            "smart_tx_observatory".to_string(),
            SubscribeRequestFilterTransactions {
                vote: Some(false),
                failed: None,
                signature: Some(signature_for_watch.clone()),
                account_include: vec![],
                account_exclude: vec![],
                account_required: vec![],
            },
        );

        let request = SubscribeRequest {
            transactions_status,
            commitment: Some(CommitmentLevel::Confirmed as i32),
            ..Default::default()
        };

        let (mut sink, mut stream) = client.subscribe_with_request(Some(request)).await?;
        info!("Yellowstone transaction-status stream active");

        while let Some(message) = stream.next().await {
            let msg = message?;
            match msg.update_oneof {
                Some(UpdateOneof::TransactionStatus(status)) => {
                    let observed_signature = Signature::try_from(status.signature.as_slice())
                        .context("decode Yellowstone transaction-status signature")?;

                    if observed_signature == parsed_signature {
                        let err = status.err.map(|e| format!("{:?}", e));
                        info!(
                            "Yellowstone observed transaction status: sig={} slot={} err={:?}",
                            observed_signature, status.slot, err
                        );
                        return Ok(Some(StreamTxStatus {
                            signature: observed_signature.to_string(),
                            slot: status.slot,
                            observed_at: Utc::now(),
                            err,
                        }));
                    }
                }
                Some(UpdateOneof::Ping(_)) => {
                    let ping_request = SubscribeRequest {
                        ping: Some(SubscribeRequestPing { id: 1 }),
                        ..Default::default()
                    };
                    if let Err(e) = sink.send(ping_request).await {
                        warn!("Failed to send Yellowstone transaction-status ping: {}", e);
                    }
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
                signature_for_timeout, timeout_secs
            );
            Ok(None)
        }
    }
}
