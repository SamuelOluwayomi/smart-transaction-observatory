use anyhow::Result;
use futures::StreamExt;
use std::collections::HashMap;
use tracing::{info, error};
use yellowstone_grpc_client::GeyserGrpcClient;
use yellowstone_grpc_proto::prelude::{
    subscribe_update::UpdateOneof,
    CommitmentLevel,
    SubscribeRequest,
    SubscribeRequestFilterSlots,
};

pub async fn stream_slots(endpoint: String, token: String) -> Result<()> {
    info!("Connecting to Yellowstone at {}", endpoint);

    // Build the gRPC client
    let mut client = GeyserGrpcClient::build_from_shared(endpoint)?
        .x_token(Some(token))?
        .connect()
        .await?;

    info!("Connected to Yellowstone gRPC");

    // Subscribe to slot updates
    let mut slots_filter = HashMap::new();
    slots_filter.insert(
        "slots".to_string(),
        SubscribeRequestFilterSlots {
            filter_by_commitment: Some(true),
        },
    );

    let request = SubscribeRequest {
        slots: slots_filter,
        commitment: Some(CommitmentLevel::Processed as i32),
        ..Default::default()
    };

    // Open the stream
    let (_, mut stream) = client.subscribe_with_request(Some(request)).await?;

    info!("Stream opened — watching live slots...");

    // Listen for updates
    while let Some(message) = stream.next().await {
        match message {
            Ok(msg) => {
                if let Some(UpdateOneof::Slot(slot_update)) = msg.update_oneof {
                    info!(
                        "Slot: {} | Status: {:?}",
                        slot_update.slot,
                        slot_update.status
                    );
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