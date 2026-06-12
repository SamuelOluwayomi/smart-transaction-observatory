use anyhow::Result;
use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub yellowstone_endpoint: String,
    pub yellowstone_token: String,
    pub solana_rpc_url: String,
    pub wallet_private_key: String,
    pub jito_block_engine_url: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenv::dotenv().ok();

        Ok(Self {
            yellowstone_endpoint: env::var("YELLOWSTONE_ENDPOINT")
                .expect("YELLOWSTONE_ENDPOINT not set"),
            yellowstone_token: env::var("YELLOWSTONE_TOKEN")
                .expect("YELLOWSTONE_TOKEN not set"),
            solana_rpc_url: env::var("SOLANA_RPC_URL")
                .expect("SOLANA_RPC_URL not set"),
            wallet_private_key: env::var("WALLET_PRIVATE_KEY")
                .expect("WALLET_PRIVATE_KEY not set"),
            jito_block_engine_url: env::var("JITO_BLOCK_ENGINE_URL")
                .expect("JITO_BLOCK_ENGINE_URL not set"),
        })
    }
}