mod config;
mod geyser;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    info!("Starting Smart Transaction Observatory Engine...");

    // Load config from .env
    let config = config::Config::from_env()?;

    info!("Config loaded. Connecting to Yellowstone...");

    // Start the Yellowstone slot stream
    geyser::stream_slots(
        config.yellowstone_endpoint,
        config.yellowstone_token,
    ).await?;

    Ok(())
}