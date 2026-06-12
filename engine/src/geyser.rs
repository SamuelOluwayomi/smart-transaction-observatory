use anyhow::Result;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use tracing::{info, error, warn};
use yellowstone_grpc_client::GeyserGrpcClient;
use yellowstone_grpc_proto::prelude::{
    subscribe_update::UpdateOneof,
    CommitmentLevel,
    SubscribeRequest,
    SubscribeRequestFilterSlots,
    SubscribeRequestPing,
};

pub async fn stream_slots(endpoint: String, token: String) -> Result<()> {
    info!("Connecting to Yellowstone at {}", endpoint);

    let tls_config = tonic::transport::ClientTlsConfig::new()
        .with_webpki_roots();

    let mut client = GeyserGrpcClient::build_from_shared(endpoint)?
        .x_token(Some(token))?
        .tls_config(tls_config)?
        .connect()
        .await?;

    info!("Connected to Yellowstone gRPC");

    let mut slots_filter = HashMap::new();
    slots_filter.insert(
        "client".to_string(),
        SubscribeRequestFilterSlots {
            filter_by_commitment: Some(true),
            interslot_updates: Some(false),
        },
    );

    // IMPORTANT: do NOT set `ping` here - it causes server to ignore other fields
    let request = SubscribeRequest {
        slots: slots_filter,
        commitment: Some(CommitmentLevel::Processed as i32),
        ..Default::default()
    };

    info!("Sending subscribe request");

    let (mut sink, mut stream) = client.subscribe_with_request(Some(request)).await?;

    info!("Stream opened -- waiting for messages...");

    while let Some(message) = stream.next().await {
        match message {
            Ok(msg) => {
                match msg.update_oneof {
                    Some(UpdateOneof::Slot(slot_update)) => {
                        info!(
                            "Slot: {} | Status: {:?}",
                            slot_update.slot,
                            slot_update.status
                        );
                    }
                    Some(UpdateOneof::Ping(_)) => {
                        // Server sent a keepalive ping - reply with ping-only request
                        let ping_request = SubscribeRequest {
                            ping: Some(SubscribeRequestPing { id: 1 }),
                            ..Default::default()
                        };
                        if let Err(e) = sink.send(ping_request).await {
                            warn!("Failed to send ping reply: {}", e);
                        }
                    }
                    other => {
                        info!("Other update: {:?}", other);
                    }
                }
            }
            Err(e) => {
                error!("Stream error: {}", e);
                break;
            }
        }
    }

    info!("Stream ended");

    Ok(())
}
