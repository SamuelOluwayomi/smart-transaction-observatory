---
sidebar_position: 6
---

# Infrastructure: SolInfra

## What is SolInfra?

[SolInfra](https://solinfra.dev/) is a Solana-native infrastructure provider built for teams that operate at production scale. It was designed to solve the fundamental reliability problems that come with relying on public Solana RPC endpoints — rate limiting, dropped connections, high latency, and lack of real-time data granularity.

The platform exposes a unified suite of Solana infrastructure services — RPC, gRPC streaming, parsed transaction data, and wallet tooling — all accessible behind a single API key.

> SolInfra's own positioning: *"Reserved RPC, Yellowstone gRPC, parsed transactions, and non-custodial wallets — behind one API key."*

## Sentry's SolInfra Plan

Sentry operates on the **SolInfra Ace plan**, provided by SolInfra as part of the up to $20,000 in infrastructure credits made available to builders during the Superteam Nigeria Advanced Infrastructure Challenge.

| Capability | Ace Plan Allocation |
|---|---|
| RPC | 300 requests/sec (dedicated, reserved capacity) |
| Send Transaction | 300 TX/sec |
| WebSocket | 2 concurrent connections |
| gRPC Streams | 1 concurrent stream |
| Priority Lane | Included |
| Support | Priority support |

The **Priority Lane** inclusion means all Sentry RPC calls are routed through SolInfra's priority capacity, reducing latency on `getLatestBlockhash`, `getSignatureStatuses`, and `simulateTransaction` calls that are on the critical path of every bundle submission.

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

SolInfra is one of the two critical external infrastructure dependencies in Sentry (alongside Jito). It is used inside the Rust engine at both the RPC and gRPC layers:

### 1. High-Frequency Slot Polling (Reserved RPC)

Instead of subscribing to a slot stream via gRPC, Sentry polls the `getSlot` method via SolInfra's reserved RPC endpoint every 400ms. Slots are retrieved at the `Processed` commitment level.

Every time the RPC poller detects a slot advancement, the slot number is written atomically into shared memory (`Arc<AtomicU64>`), making it immediately available to:

- The bundle builder, which stamps each bundle submission with the live slot at time of construction.
- The Next.js API, which polls the slot value and streams it to the live **Slot Pulse** panel on the dashboard via Server-Sent Events.
- The latency diagnostics module, which uses the submit slot and the landed slot to calculate the `slot delta` — the number of network slots that elapsed between submission and on-chain landing.

This offloads slot tracking from the gRPC layer, reserving valuable stream limits for transaction status updates.

### 2. Transaction Status Streaming (Yellowstone gRPC)

After a bundle is submitted to the Jito Block Engine, the Rust engine opens a transaction subscription on SolInfra's Yellowstone stream for the specific transaction signature included in the bundle. This subscription listens directly to the validator network for the `Confirmed` commitment level:

- `Confirmed` → a supermajority of the cluster has confirmed the block

This state transition timestamp is recorded in the lifecycle log (`lifecycle_log.jsonl`). Timestamps for other stages are retrieved via concurrent status tracking:

| Metric | Description |
|---|---|
| Processed delta | Time from submission to first validator observation |
| Processed → Confirmed | Time to reach supermajority confirmation |
| Confirmed → Finalized | Time to reach ledger finality |

---

## Configuration

To use SolInfra in your own deployment of Sentry, you will need an active SolInfra account and a provisioned API key. Set the following environment variables:

```bash
YELLOWSTONE_ENDPOINT=https://grpc.solinfra.dev
YELLOWSTONE_TOKEN=your_solinfra_api_key_here
```

The Rust engine reads these at startup and opens the gRPC connection automatically.

### gRPC Stream Allocation

The SolInfra Ace plan provides **1 concurrent gRPC stream**. 

To maximize confirmation accuracy and guarantee stream-based landing verification:
1. **Slot Tracking** is offloaded to a background thread polling SolInfra's reserved RPC endpoint every 400ms.
2. **Transaction confirmation** has exclusive, uncompeted access to the single allocated gRPC stream.

As a result, Sentry establishes the gRPC transaction watcher stream successfully on every bundle run, logging `confirmation_source: "yellowstone_stream"` rather than falling back to RPC polling. If the stream encounters network drops, Sentry gracefully defaults to RPC `getSignatureStatuses` polling (`rpc_polling_fallback`) to maintain system resilience.

Visit [solinfra.dev](https://solinfra.dev/) to create an account and provision your gRPC endpoint.

import AIAssistant from '@site/src/components/AIAssistant';

<AIAssistant />
