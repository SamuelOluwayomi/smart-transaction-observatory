use anyhow::Result;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use tracing::{info, error, warn};
use yellowstone_grpc_client::{ClientTlsConfig, GeyserGrpcClient};
use yellowstone_grpc_proto::prelude::{
    subscribe_update::UpdateOneof,
    CommitmentLevel,
    SubscribeRequest,
    SubscribeRequestFilterSlots,
    SubscribeRequestPing,
};

pub async fn stream_slots(endpoint: String, token: String) -> Result<()> {
    info!("Connecting to Yellowstone at {}", endpoint);

    let mut client = GeyserGrpcClient::build_from_shared(endpoint)?
        .x_token(Some(token))?
        .tls_config(ClientTlsConfig::new().with_webpki_roots())?
        .connect()
        .await?;

    info!("Connected to Yellowstone gRPC");

    let mut slots_filter = HashMap::new();
    slots_filter.insert(
        "slots".to_string(),
        SubscribeRequestFilterSlots {
            filter_by_commitment: Some(true),
            interslot_updates: Some(false),
        },
    );

    let request = SubscribeRequest {
        slots: slots_filter,
        commitment: Some(CommitmentLevel::Processed as i32),
        ping: Some(SubscribeRequestPing { id: 1 }),
        ..Default::default()
    };

    let (mut sink, mut stream) = client.subscribe_with_request(Some(request)).await?;

    info!("Stream opened — watching live Solana slots...");
    info!("─────────────────────────────────────────────");

    while let Some(message) = stream.next().await {
        match message {
            Ok(msg) => {
                match msg.update_oneof {
                    Some(UpdateOneof::Slot(slot_update)) => {
                        info!(
                            "🟢 Slot: {} | Status: {:?}",
                            slot_update.slot,
                            slot_update.status
                        );
                    }
                    Some(UpdateOneof::Ping(_)) => {
                        let ping_request = SubscribeRequest {
                            ping: Some(SubscribeRequestPing { id: 1 }),
                            ..Default::default()
                        };
                        if let Err(e) = sink.send(ping_request).await {
                            warn!("Failed to send ping reply: {}", e);
                        }
                    }
                    _ => {}
                }
            }
            Err(e) => {
                error!("Stream error: {}", e);
                break;
            }
        }
    }

    Ok(())
}
