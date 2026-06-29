---
sidebar_position: 2
---
# Architecture & System Design

This document explains the technical architecture, key components, data flow, infrastructure decisions, failure handling, and AI agent logic for **Sentry**, a smart transaction stack built for Solana.

---

## Table of Contents
1. [System Architecture](#1-system-architecture)
2. [Key Components](#2-key-components)
3. [Data Flow Between Services](#3-data-flow-between-services)
4. [Infrastructure Decisions](#4-infrastructure-decisions)
5. [Failure Handling Strategy](#5-failure-handling-strategy)
6. [AI Agent Responsibilities](#6-ai-agent-responsibilities)
7. [Memory Management & Leak Prevention](#7-memory-management-&-leak-prevention)
8. [Dependency Directory](#8-dependency-directory)

---

## 1. System Architecture

### 1.1 Overview
Sentry is a high-performance transaction execution pipeline with real-time network awareness and intelligent decision-making. It utilizes a hybrid Solana gateway (combining Yellowstone gRPC streams for microsecond-precision transaction confirmation with high-frequency RPC slot polling), leverages Jito Bundles at the execution layer for optimal transaction package submission, and uses a decoupled AI Agent as the brain to analyze failures, tune transaction parameters dynamically, and orchestrate self-healing retries. 

These layers form a closed-loop system: Observe (Yellowstone gRPC + RPC Slot Poller) → Decide (AI Agent Policy + LLM Chain) → Execute (Rust Jito Bundle Builder) → Monitor (Multi-stage lifecycle tracking) → Self-Heal (Auto-retry loop).

### 1.2 System Architecture Diagram

```mermaid
graph TD
    %% Services
    subgraph Local_Stack [Sentry Multi-Container Grid]
        Engine[Rust Engine Daemon]
        Agent[AI Agent Daemon]
        Console[NextJS Web Console]
        SharedVol[(Shared Filesystem Volume)]
    end

    subgraph External_Infrastructure [Infrastructure Providers]
        SolInfra[SolInfra Ace Plan]
        Jito[Jito Block Engine]
        Groq[Groq AI Inference API]
    end

    %% Communication Loops
    Engine -->|Write Telemetry to log.jsonl| SharedVol
    Agent -->|Read Telemetry| SharedVol
    Agent -->|Write Decisions to decisions.jsonl| SharedVol
    Console -->|Read Logs & Decisions| SharedVol

    %% Inputs/Outputs
    Engine <-->|Slot RPC Polling & gRPC stream| SolInfra
    Engine -->|Submit base64 Bundles| Jito
    Agent <-->|LLM Second Opinion| Groq
    Console <-->|SSE Slot Pulse & Submission| Client[Web Browser Client]
```

---

## 2. Key Components

### 2.1 Rust Engine (`engine/`)
The Rust Engine is the core high-performance execution layer, written in Rust for zero NAPI compilation overhead and multi-threaded reliability.
* **`main.rs`**: Entry point. Boots the engine, spawns the background slot RPC poller, orchestrates the bundle loop, triggers Yellowstone streams, and manages automatic retries.
* **`config.rs`**: Decodes and loads environment configurations via `dotenv`, validating wallet balance requirements (minimum 50,000 lamports enforced on startup).
* **`geyser.rs`**: Configures the Yellowstone gRPC client. Opens a gRPC subscription request filtered by the operator's wallet `account_include` address, using a Tokio `oneshot` synchronization channel to notify when the stream handshake is complete.
* **`jito.rs`**: Fetches active Jito validator accounts via `getTipAccounts`, queries Jito's dynamic tip floor API, simulates transactions locally, constructs the memo + tip bundle, and serializes the signed transaction in base64.
* **`jito.rs`**: Fetches active Jito validator accounts via `getTipAccounts`, queries Jito's dynamic tip floor API, simulates transactions locally, constructs the memo + tip bundle, serializes the signed transaction in base64, and dispatches to **5 regional block engines in parallel** via `dispatch_to_all_regions()`.
* **`lifecycle.rs`**: Implements the multi-stage confirmation poller (`track_bundle`), polling Solana RPC `getSignatureStatuses` and Jito `getInflightBundleStatuses` concurrently to record execution timestamps.

### 2.4 Leader Window Gating

Before constructing or submitting a bundle, the engine calls `wait_for_leader_window()` which fetches the upcoming Jito leader schedule and holds submission until the current slot is within 2 slots of the nearest Jito leader (`leaderDistanceSlots ≤ 2`). This maximises the probability that the bundle arrives at the block engine's auction queue during the active leader's window, rather than being forwarded across slot boundaries.

If the Jito leader schedule endpoint returns no data (network error, empty response), the function returns immediately and submission proceeds without blocking.

### 2.5 Multi-Region Parallel Dispatch

Bundles are dispatched simultaneously to all 5 regional Jito block engines using `dispatch_to_all_regions()`. All requests fire concurrently; the first region to return a success response wins, and the rest are discarded.

| Region | Endpoint |
|---|---|
| Global | `mainnet.block-engine.jito.wtf` |
| New York | `ny.mainnet.block-engine.jito.wtf` |
| Amsterdam | `amsterdam.mainnet.block-engine.jito.wtf` |
| Frankfurt | `frankfurt.mainnet.block-engine.jito.wtf` |
| Tokyo | `tokyo.mainnet.block-engine.jito.wtf` |

This materially reduces slot-auction miss rate when the current Jito leader is in a non-primary region. The winning region is logged for every run.

### 2.2 AI Agent Layer (`agent/`)
An autonomous background observer written in Node.js/TypeScript.
* **State Analyzer (`index.ts`)**: Ingests the JSONL log from the shared volume, computes sliding-window statistics (landed rate, latency, failure stages), and applies a deterministic rule policy.
* **Groq LLM Chain**: Forwards the local policy decision and raw network state to a Groq chat completion API (using `llama-3.3-70b-versatile` or fallbacks) to check safety bounds, audit tip floors, and output a validated JSON action structure.

### 2.3 Dashboard Console (`app/` & `lib/`)
* **Next.js Server (`lib/observatory.ts`)**: Parses shared logs, handles dynamic tip APIs, and compiles transaction bundles for manual console submissions.
* **Web UI Component (`app/page.tsx`)**: Exposes SSE routes for live slot pulsing and progress streams, rendering real-time metrics, lifecycle progress, and the AI agent reasoning panel.

---

## 3. Data Flow Between Services

### 3.1 Main Flow: Slot Detection → Window Validation → Bundle Submission

```mermaid
sequenceDiagram
    autonumber
    participant Poller as RPC Slot Poller
    participant Main as Rust Engine Loop
    participant Jito as Jito Block Engine
    participant Geyser as Yellowstone gRPC Stream

    %% Slot updates
    loop Every 400ms
        Poller->>Main: Update Slot in Arc<AtomicU64>
    end

    %% Build bundle
    Note over Main: Loop starts next run profile
    Main->>Main: Fetch latest slot from AtomicU64
    Main->>Main: Fetch dynamic Jito tip floor (75th percentile)
    Main->>Main: Simulate transaction locally via RPC
    
    %% Pre-connection
    Main->>Geyser: Connect & open stream (handshake)
    Geyser-->>Main: Oneshot channel fires: Stream active!
    
    %% Submit bundle
    Main->>Jito: POST sendTransaction (serialized base64 bundle)
    Jito-->>Main: Return bundle ID and signature
    Main->>Geyser: Listen for transaction on wallet address
    Geyser-->>Main: Observe on-chain signature at Confirmed commitment
    Note over Main: Record confirmation_source = "yellowstone_stream"
```

### 3.2 Transaction Lifecycle Tracking Flow

```mermaid
sequenceDiagram
    autonumber
    participant Engine as Rust Engine
    participant Log as shared_volume/lifecycle_log.jsonl
    participant Agent as AI Agent Daemon
    participant DecLog as shared_volume/agent_decisions.jsonl
    participant Web as NextJS Backend
    participant Browser as Dashboard Frontend

    %% Bundle Loop
    Note over Engine: Builds & submits bundle to Jito
    Engine->>Log: Write Run #N (status=Submitted, submit_slot)
    
    %% Geyser Confirmation
    Note over Engine: Receives gRPC transaction status
    Engine->>Log: Update Run #N (status=Landed, landed_slot, yellowstone_stream)
    
    %% Agent Ingestion
    Note over Agent: Polls shared volume every 10s
    Log->>Agent: Ingest latest 10 runs
    Note over Agent: Evaluates risk & tip bounds
    Agent->>DecLog: Write recommendation (recommended_tip, confidence)
    
    %% Web Updates
    Web->>DecLog: Polls / reads latest decision
    Web->>Log: Polls / reads latest runs
    Web->>Browser: Send SSE telemetry / Slot Pulse
```

---

## 4. Infrastructure Decisions

### 4.1 Why Rust for the Core Transaction Engine?
Solana slots update every 400 milliseconds, and block space is highly contested. Pure JavaScript/TypeScript engines introduce garbage collection pauses, NAPI native compilation friction, and slower serialization. By using Rust, Sentry guarantees near-zero latency overhead for cryptographic signing, transaction simulation, and gRPC stream handling, ensuring the transaction lands within the Jito leader schedule window.

### 4.2 Optimizing for the SolInfra Ace Plan Limit (1 Concurrent Stream)
The SolInfra Ace Plan restricts the stack to **1 concurrent gRPC stream**. Attempting to stream slot updates and watch transaction confirmations over separate gRPC connections causes stream exhaustion, drops, and timeouts. 

Sentry resolves this by **offloaded slot updates to a high-frequency (400ms) RPC poller** querying `getSlot` at `Processed` commitment. This preserves the single gRPC stream slot exclusively for transaction confirmation subscriptions, guaranteeing stream-based confirmations on every run.

### 4.3 Why Open the Geyser Stream Before Submission?
gRPC handshakes and filter propagation take 1 to 3 seconds over TLS. If a Jito bundle lands on Solana within 2 to 3 seconds of submission, opening the Geyser stream *after* submission introduces a race condition: the transaction lands before the stream is active, and since Geyser does not play back historical events, the landing is missed. Sentry pre-establishes the gRPC stream *before* calling Jito and uses a Tokio `oneshot` channel to proceed once the stream is ready.

### 4.4 Regional Network Advantage: AMS vs NYC/FRA
During on-chain testing, telemetry revealed that deploying Sentry near **Amsterdam (AMS)** yielded significantly lower Yellowstone transaction observation latencies compared to New York (NYC) or Frankfurt (FRA). This regional speed advantage minimizes the window between `Processed` and `Confirmed` blocks and ensures gRPC streams connect faster.

### 4.5 Dynamic Tip Formula

The tip for every bundle is calculated as:

```
final_tip = max(FLOOR, p75_lamports).min(CAP)
```

- **FLOOR = 30,000 lamports** — empirically proven mainnet minimum. The Jito public tip API consistently underreports market-clearing prices (reporting medians of 1k–5k lamports while sub-30k tips land unreliably).
- **CAP = 100,000 lamports** — budget protection ceiling.
- **p75_lamports** — live `landed_tips_75th_percentile` from the Jito tip floor API, converted to lamports.
- On AI-directed retries, the agent outputs a `tipAdjustmentFactor` and the engine applies: `new_tip = min(current_tip × factor, CAP)`.

No tip value is hardcoded in the normal submission path — the live API drives every decision.

### 4.6 Bundle UUID Does Not Mean On-Chain Inclusion

Jito's block engine returns an HTTP 200 with an `x-bundle-id` UUID for **every** submitted bundle — including bundles that lose the slot auction or fail simulation. A UUID cannot be interpreted as confirmation of inclusion.

Sentry resolves this with concurrent post-submission monitoring:
- **`getInflightBundleStatuses`** (Jito side): Detects early rejections (`Failed`, `Invalid`) and surfaces the real rejection reason before the transaction would appear on-chain.
- **`getSignatureStatuses`** (Solana RPC): The authoritative source. Confirmation here means the bundle is genuinely on-chain.

A bundle confirmed by neither source within 45 seconds is classified as `BUNDLE_FAILURE` and escalated to the AI agent.

---

## 5. Failure Handling Strategy

### 5.1 Failure Matrix

| Failure Type | Trigger Condition | Automated Resolution | AI Agent Involvement |
|---|---|---|---|
| `zero_tip` | Jito bundle tip is set to 0 | Engine rejects submission locally, logs error | Yes (recommends tip increase) |
| `blockhash_expired` | Stale blockhash is used, simulation fails | Fetch fresh blockhash, rebuild, and retry | Yes (increases retry priority) |
| `rate_limit_exhausted` | Jito HTTP status 429 is received | Retry with exponential backoff (2s, 4s, 6s, 8s) | Yes (recommends hold if persistent) |
| `jito_rejection` | Invalid bundle structure or signatures | Logs Jito block engine rejection details | Yes (logs fail reason) |
| `confirmation_timeout` | No landing confirmed after 58 seconds | Triggers fallback RPC tracker | Yes (audits for network dropouts) |
| `stream_disconnected` | Network drop at Yellowstone gRPC layer | Re-establishes connection using backoff | None (handles at transport layer) |

### 5.2 Automatic Retry Control Loop
If a non-intentional failure occurs during execution, the engine runs an autonomous recovery loop:
1. Re-queries Solana RPC for a fresh `getLatestBlockhash`.
2. Queries the Jito tip floor API to recalculate a competitive percentile tip.
3. Re-signs and serializes the new transaction.
4. Resubmits the bundle to Jito.
5. Logs the retry as a separate JSONL entry, marking the original's `recovery` field.

---

## 6. AI Agent Responsibilities

### 6.1 Two-Tier Decision Architecture
To keep the core Rust transaction engine fast, Sentry completely separates AI reasoning into an asynchronous TypeScript daemon:
1. **Tier 1 (Deterministic Rules)**: Calculates sliding-window stats (success rate, average latency, failure patterns) to determine baselines (e.g. action: `hold` if success rate < 30%).
2. **Tier 2 (Groq LLM Chain)**: Forwards the baseline decision and network logs to Groq (`llama-3.3-70b-versatile`) as context. The LLM performs a cognitive audit against safety constraints and outputs the final JSON instruction.

### 6.2 Fail-safe Model Cascading
If the primary LLM model fails, the agent automatically attempts connection to fallback models in sequence to prevent stack blockage:
`openai/gpt-oss-120b` → `llama-3.3-70b-versatile` → `llama-3.1-8b-instant` → `local-policy` (fallback: true)

### 6.3 Security Design: Key Isolation
>[!IMPORTANT]
> The AI Agent operates entirely on metadata. Under no circumstances are private keys, keypair bytes, or raw transaction buffers sent to the Groq API or external AI servers. Transaction signing is done strictly locally inside the Rust Engine and Node.js server using private key arrays stored in the local `.env` environment variables.

---

## 7. Operational Learnings (Mainnet)

These insights come from running the full stack against Solana mainnet and represent the difference between a stack that works in theory and one that works in production.

| Learning | Detail |
|---|---|
| **UUID ≠ Inclusion** | Jito returns a UUID for every bundle, including ones that lose the slot auction. Without `getInflightBundleStatuses`, a rejected bundle looks identical to a pending one. |
| **Tip API underreports** | Public tip API medians (1k–5k lamports) don't reflect real landing cost. Empirical mainnet floor is 30,000 lamports for self-transfer payloads. |
| **gRPC stream is a finite resource** | SolInfra Ace allows one concurrent subscribe stream. Using it for both slot tracking and tx confirmation causes contention. Reserve it for confirmation; use RPC for slots. |
| **`confirmed` blockhash is non-negotiable** | A `finalized` blockhash consumes ~20% of the 150-slot validity window before signing. Always fetch at `confirmed` commitment. |
| **Inline-tip bundles only** | Separate `addTipTx()` bundle patterns were accepted (UUID returned) but never appeared on-chain. Single-transaction inline-tip bundles are the only reliable pattern. |
| **Fault injection proves the loop** | `Hash::default()` and 0-lamport tips produce real on-chain rejections, not synthetic exceptions. The full detect → classify → reason → decide → retry loop is validated end-to-end. |

---

## 8. Memory Management & Leak Prevention

* **Atomic Registers**: Sentry uses a lock-free `AtomicU64` register for slots, ensuring the latest slot update simply overwrites the old value, preventing slot queue memory build-ups.
* **Periodic Cleanup**: In the Next.js console backend, the `TransactionTracker` maintains a 5-minute cleanup interval using `setInterval().unref()` to prune unconfirmed signatures from memory, preventing memory leaks in long-running dashboard processes.
* **LIFO Telemetry**: Telemetry queries are kept to the last 10 entries using array slicing (`runs.slice(0, 10)`), preventing memory bloat during infinite loops.

---

## 8. Dependency Directory

### 8.1 Rust Engine Crate Dependencies
* `yellowstone-grpc-client` (v12.1.0): gRPC client for Yellowstone validator streams.
* `yellowstone-grpc-proto` (v12.1.0): Protobuf definitions for Geyser messages.
* `solana-sdk` (^2.1): Transaction signing and cryptographic serialization.
* `solana-rpc-client` (^2.1): RPC communication with Solana mainnet.
* `tokio` (v1.0): Multi-threaded asynchronous runtime.
* `tonic` (v0.14): Transport engine for gRPC streams.
* `reqwest` (v0.12): High-frequency slot polling client.

### 8.2 Node.js / TypeScript Dependencies
* `next` (v16.2.6): Web dashboard engine and API routes.
* `@solana/web3.js` (^1.98.4): Mainnet Solana library (locked for Jito compatibility).
* `ws` (^8.18.3): Server-Sent Events (SSE) websocket communication.
* `tsx` (^4.19.0): Low-overhead execution wrapper for the agent daemon.

---

## 9. Programmatic SDK & Standalone Server

To support integration into external dApps, searchers, or trading bots, Sentry includes a programmatic SDK and a standalone REST API server.

### 9.1 Programmatic TypeScript SDK (`lib/sentry-sdk.ts`)

Developers can import Sentry directly to execute transactions via the Jito Block Engine pipeline with built-in telemetry:

```typescript
import { Sentry } from "./lib/sentry-sdk";

const sentry = new Sentry();
await sentry.start(); // Warmed up Node & RPC connections

const result = await sentry.submit([myInstruction], { urgency: "medium" });
if (result.success) {
  console.log(`Landed transaction at slot ${result.slot}: ${result.signature}`);
}
```

The SDK accepts the following inputs:
- `TransactionInstruction[]`: Auto-appends the tip instruction, fetches latest blockhash, signs, simulates, and submits.
- `Transaction` / `VersionedTransaction` (unsigned): Automatically signs, simulates, and submits.
- `Pre-signed Transaction`: Submits as-is. If the input is pre-signed, Sentry automatically constructs a **Multi-Transaction Bundle** combining the user's transaction with a separate tip payment transaction, allowing tip integration without invalidating the pre-existing user signature.
- `Base64 / Base58 String`: Deserializes the transaction and routes as above.

> **Local Signature Derivation**: The SDK derives transaction signatures locally and formats them as standard **base58** strings (using the `bs58` library) rather than base64. This prevents empty status query results and ensures the Yellowstone gRPC stream and RPC polling loops correctly track transaction confirmation status.

### 9.2 Standalone REST API Server (`server.ts`)

A lightweight HTTP server written with Node's native `http` module. It exposes:
- **`GET /health`**: Returns the health of RPC node and validator stream interfaces.
- **`POST /submit`**: Accepts JSON payloads:
  ```json
  {
    "transaction": "<base64-serialized-tx>",
    "urgency": "low" | "medium" | "high"
  }
  ```
  - **`low`** maps to the Jito 25th percentile tip floor.
  - **`medium`** maps to the Jito 75th percentile tip floor.
  - **`high`** maps to the Jito 95th percentile tip floor.

---

## 10. Mainnet Validation Test Harnesses (`scripts/harnesses/`)

Sentry includes 6 standalone test scripts in `scripts/harnesses/` to validate all pipeline layers against live Solana mainnet conditions:

| Script | Command | Purpose |
|---|---|---|
| `harness_faults.ts` | `npm run harness:faults` | Simulates standard execution (using a 1,000-lamport self-transfer to bypass Solana rent-exemption floors), zero tip failures, blockhash expirations, and simulation errors with AI reasoning console logs. |
| `harness_trader.ts` | `npm run harness:trader` | Simulates swapping SOL ⇄ USDC via Jupiter API, demonstrating quote expiry, slippage boundary breaches, and Jito leader skips. |
| `harness_requote.ts` | `npm run harness:requote` | Demonstrates that Sentry does not blindly fail on slippage; instead, it re-quotes fresh swap routes via Jupiter, re-signs, and submits. |
| `harness_sniper.ts` | `npm run harness:sniper` | Models liquidity pool detection, route lookup, high-congestion tip, and +1 slot bundle sniping. |
| `harness_budget.ts` | `npm run harness:budget` | Enforces a session budget cap; the AI holds/aborts when upcoming tip requirements exceed remaining pool limits. |
| `harness_mev.ts` | `npm run harness:mev` | Audits MEV exposure, showing side-by-side transaction cost and searcher frontrun/backrun risk comparison (Public Route vs. Jito Bundle). |

