---
sidebar_position: 2
---
# Architecture

## 3. Rust Engine & gRPC
The core execution pipeline resides in the Rust-based daemon located in `/engine`. Rust was selected to handle critical tasks like streaming network parameters, managing cryptographic keys, and executing zero latency RPC operations.

### Yellowstone gRPC Stream Integration
Sentry relies on high-speed gRPC streams (such as those provided by SolInfra) rather than standard polling web sockets. This connection runs inside a dedicated thread inside the Rust engine:
1. **Slot Streaming**: Subscribes to the live validator network to receive block headers at the `Processed` level. Every time the validator network advances, the newest slot is updated in atomic storage.
2. **Transaction Status Streaming**: Subscribes directly to target transaction signatures to detect landing confirmations within milliseconds of execution.
3. **Dynamic Failover**: If gRPC rate limits are reached or the stream drops, the Rust engine automatically falls back to RPC signature status polling to prevent diagnostic failures.

### Jito Block Engine Bundle Pipeline
Instead of submitting individual transactions that can get frontrun or lost, Sentry builds Jito bundles. A memo transaction containing diagnostic data (such as the target slot and timestamp) is constructed, signed with the operator keypair, and serialized. A tip transaction is appended as the second transaction in the bundle, sending lamports directly to a Jito tip account.

**Bundle Submission Loop**
1. Query Jito Tip Floor API → get p75 validator fee floor
2. Fetch live blockhash from Solana RPC
3. Fetch latest slot from Atomic Yellowstone gRPC storage
4. Build Transaction 1: Memo diagnostic instruction
5. Build Transaction 2: Transfer dynamic tip to Jito address
6. Submit bundle to Jito Block Engine
7. Extract `x-bundle-id` header from response
8. Poll Jito + Solana RPC until status resolves (Landed / Failed / Invalid)

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
