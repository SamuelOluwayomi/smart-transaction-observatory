---
sidebar_position: 2
---
# Architecture

## 3. Rust Engine & gRPC
The core execution pipeline resides in the Rust-based daemon located in `/engine`. Rust was selected to handle critical tasks like streaming network parameters, managing cryptographic keys, and executing zero latency RPC operations.

### Yellowstone gRPC & RPC Integration
Sentry relies on high-speed Yellowstone gRPC streams for transaction landing confirmation, and high-frequency RPC polling for live slot tracking:
1. **Slot Tracking (RPC Polling)**: The engine polls the `getSlot` method via SolInfra's reserved RPC endpoint every 400ms using a background task. Slots are tracked at the `Processed` commitment level. Every new slot update is written to shared atomic storage (`Arc<AtomicU64>`) and notifies waiters via `tokio::sync::Notify`. This offloads slot tracking from gRPC streams, avoiding stream exhaustion.
2. **Transaction Status Streaming (gRPC)**: Subscribes directly to target transaction signatures via a Yellowstone gRPC stream to detect landing confirmations within milliseconds of execution.
3. **Dynamic Failover**: If the Yellowstone stream drops due to network connectivity issues, the Rust engine automatically falls back to Solana RPC `getSignatureStatuses` polling to prevent diagnostic failures.

### gRPC Confirmation Strategy & Resilience Design

The bounty specification requires that transaction landing be confirmed via **stream subscriptions**, not RPC polling alone. Sentry fully implements this via `geyser.rs`:

After each bundle is submitted, the Rust engine opens a Yellowstone gRPC connection and sends a `SubscribeRequestFilterTransactions` filtered to the exact transaction signature at `CommitmentLevel::Confirmed`. This is the **primary confirmation path** — when it fires, it records the slot, timestamp, and any on-chain errors before any RPC poll would return.

**The gRPC Stream Allocation**

Sentry runs on the **SolInfra Ace plan** (provided by SolInfra as infrastructure support for the bounty). The Ace plan allocates **1 concurrent gRPC stream**. 

To satisfy the stream subscription requirement without hitting this plan limit:
1. Sentry offloads slot tracking to high-frequency (400ms) RPC polling.
2. The single available gRPC stream is reserved **exclusively** for the transaction confirmation subscription (`SubscribeRequestFilterTransactions`).

This layout ensures that the stream limit is never exceeded during operation. The Yellowstone transaction status subscription connects successfully on every single run, recording `yellowstone_stream` as the confirmation source.

This is visible in the lifecycle log via the `confirmation_source` field:

| Value | Path | Trigger |
|---|---|---|
| `yellowstone_stream` | gRPC `TransactionStatus` subscription | Yellowstone stream successfully established (expected on every run) |
| `rpc_polling_fallback` | Solana RPC `getSignatureStatuses` | Network failure fallback if the gRPC connection drops |

### Jito Block Engine Bundle Pipeline
Instead of submitting individual transactions that can get frontrun or lost, Sentry builds Jito bundles. A memo transaction containing diagnostic data (such as the target slot and timestamp) is constructed, signed with the operator keypair, and serialized. A tip transaction is appended as the second transaction in the bundle, sending lamports directly to a Jito tip account.

**Bundle Submission Loop**
1. Query Jito Tip Floor API → get p75 validator fee floor
2. Fetch live blockhash from Solana RPC
3. Fetch latest slot from atomic storage (updated by the RPC poller)
4. Build Transaction 1: Memo diagnostic instruction
5. Build Transaction 2: Transfer dynamic tip to Jito address
6. Submit bundle to Jito Block Engine
7. Extract `x-bundle-id` header from response
8. Poll Jito + Solana RPC/gRPC until status resolves (Landed / Failed / Invalid)

## 6. Docker Architecture
Sentry is containerized to allow developers and judges to run the entire multi-service stack with a single command. The Docker configuration is orchestrated via Docker Compose.

### The Multi-Container Grid
When running `docker compose up --build`, Docker spins up three isolated services:
1. **rust-engine**: Built on alpine. Connects to Yellowstone gRPC, constructs and signs transaction bundles, and logs activities.
2. **node-agent**: Built on Node. Reads logs via shared volume, calculates statistics, and executes Groq LLM audits.
3. **nextjs-dashboard**: Exposes the dashboard on port 3000. Provides real-time charts, streams slots, and triggers manual bundle runs.

### Shared Volume Communication
Because containers do not share an operating system memory space, Sentry uses a shared volume mount:
* A volume named `sentry-logs` is mounted inside all three containers.
* The Rust engine writes telemetry events directly to `/app/logs/lifecycle_log.jsonl`.
* The Node agent monitors the file inside the mount and writes decisions to `/app/logs/agent_decisions.jsonl`.
* The Next.js API read-handlers poll this volume, serving the latest logs to the web interface.

### Docker Orchestration Commands
Manage the container grid using standard Docker Engine command inputs:

```bash
# Build and run the entire pipeline
docker compose up --build

# Shutdown the grid and erase persistent volumes
docker compose down -v
```
