---
sidebar_position: 5
---
# Troubleshooting

## 8. Troubleshooting

**Error: "insufficient funds for tip payment"**
* **Cause**: The operator wallet balance is too low to pay the Jito fee.
* **Solution**: Copy the address from the *Slot Pulse* panel on the dashboard (by clicking the copy button) and transfer a small amount of SOL (e.g. 0.05 SOL) to it on Mainnet.

**Error: "blockhash not found"**
* **Cause**: Solana RPC blockhash is stale, or the network is highly congested.
* **Solution**: The Rust engine handles this autonomously and will trigger a retry. If it persists, verify your RPC node endpoint settings in your configuration file.

**Error: "Yellowstone stream disconnected"**
* **Cause**: The gRPC provider rejected the auth token, or the connection timed out.
* **Solution**: Verify that your gRPC token is valid and active. If the gRPC connection fails, transaction confirmation will fall back to RPC polling (`rpc_polling_fallback`) without any loss of data.
