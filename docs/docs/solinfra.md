---
sidebar_position: 6
---

# Infrastructure: SolInfra

## What is SolInfra?

[SolInfra](https://solinfra.dev/) is a Solana-native infrastructure provider built for teams that operate at production scale. It was designed to solve the fundamental reliability problems that come with relying on public Solana RPC endpoints — rate limiting, dropped connections, high latency, and lack of real-time data granularity.

The platform exposes a unified suite of Solana infrastructure services — RPC, gRPC streaming, parsed transaction data, and wallet tooling — all accessible behind a single API key.

> SolInfra's own positioning: *"Reserved RPC, Yellowstone gRPC, parsed transactions, and non-custodial wallets — behind one API key."*

---

## Services Offered

### Reserved RPC
SolInfra provides dedicated, reserved RPC capacity — unlike public endpoints which throttle requests unpredictably. This means per-method rate limiting, regional routing, SLA-backed uptime, and no competition with other anonymous users sharing the same node. Sentry depends on RPC calls for blockhash fetching, balance queries, and signature status polling, so endpoint reliability is a hard requirement.

### Yellowstone gRPC Streaming
The flagship service for high-performance use cases. Yellowstone is the Solana validator plugin that exposes a gRPC interface for subscribing to real-time validator data. SolInfra runs this infrastructure at scale, providing:

- **Slot subscriptions**: Receive every new validator slot the instant it is observed at the `Processed` commitment level, before it is confirmed or finalized.
- **Transaction subscriptions**: Subscribe directly to specific transaction signatures and receive confirmation state updates in real time.
- **Account subscriptions**: Watch on-chain accounts for state changes as they happen.
- **Jito ShredStream**: Pre-block visibility into transaction shreds, which is critical for MEV-sensitive and high-frequency trading workflows.

The gRPC protocol operates at significantly lower overhead than polling-based WebSocket subscriptions, making it the preferred tool for latency-critical operations.

### Parsed Transaction Data
SolInfra decodes raw Solana transaction data into human-readable structured formats, reducing the amount of deserialization work required by client applications. This simplifies integration for indexers, analytics platforms, and dashboards.

### Wallet Infrastructure
SolInfra offers server-side BIP-39 wallet solutions for programmatic key management, targeted at backend services that need non-custodial signing capabilities without manual key management.

### Billing Model
gRPC stream consumption is billed on a pay-as-you-go (PAYG) bytes-based model — you pay only for the volume of data your stream actually consumes, rather than a flat rate for idle connection time.

---

## How SolInfra Powers Sentry

SolInfra is one of the two critical external infrastructure dependencies in Sentry (alongside Jito). It is used directly inside the Rust engine at the gRPC layer for two specific functions:

### 1. Live Slot Streaming (Slot Pulse)

The Rust engine opens a persistent Yellowstone gRPC connection to SolInfra on startup. It subscribes to the validator's slot stream at `Processed` commitment level — the earliest possible point at which slot data is available from the network.

Every time the Solana validator advances to a new slot, the engine's stream receives a notification. The slot number is written atomically into shared memory inside the engine, making it immediately available to:

- The bundle builder, which stamps each bundle submission with the live slot at time of construction.
- The Next.js API, which polls the slot value and streams it to the live **Slot Pulse** panel on the dashboard.
- The latency diagnostics module, which uses the submit slot and the landed slot to calculate the `slot delta` — the number of network slots that elapsed between submission and on-chain landing.

This is why Sentry's slot readings arrive in milliseconds rather than the 400–800ms delay that comes with WebSocket polling. The gRPC stream bypasses the intermediate polling layer entirely.

### 2. Transaction Status Streaming

After a bundle is submitted to the Jito Block Engine, the Rust engine simultaneously opens a transaction subscription on SolInfra's Yellowstone stream for the specific transaction signature included in the bundle. This subscription listens directly to the validator network for state transitions:

- `Processed` → the transaction has been observed by the validator
- `Confirmed` → a supermajority of the cluster has confirmed the block
- `Finalized` → the block is irreversible

Each state transition timestamp is recorded in the lifecycle log (`lifecycle_log.jsonl`). These three timestamps power the multi-stage latency diagnostics visible in Sentry's evidence panel:

| Metric | Description |
|---|---|
| Processed delta | Time from submission to first validator observation |
| Processed → Confirmed | Time to reach supermajority confirmation |
| Confirmed → Finalized | Time to reach ledger finality |

Without SolInfra's gRPC subscription capability, resolving all three commitment states would require repeated polling against Solana RPC, introducing artificial delay and making the timing measurements inaccurate.

---

## Configuration

To use SolInfra in your own deployment of Sentry, you will need an active SolInfra account and a provisioned API key. Set the following environment variables:

```env
YELLOWSTONE_GRPC_URL=https://grpc.solinfra.dev
YELLOWSTONE_GRPC_TOKEN=your_solinfra_api_key_here
```

The Rust engine reads these at startup and opens the gRPC connection automatically. If the connection drops due to rate limiting or a network interruption, the engine falls back to Solana JSON-RPC polling for slot updates to prevent data loss.

Visit [solinfra.dev](https://solinfra.dev/) to create an account and provision your gRPC endpoint.
