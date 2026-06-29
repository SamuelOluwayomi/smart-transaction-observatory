# Sentry Architecture

## System Overview

Sentry is a full-stack transaction operations system designed to submit Jito bundles with high reliability, track their multi-stage commitment lifecycle, and employ an autonomous AI agent to make operational tip and retry decisions.

It consists of three primary components:

1. **Rust Engine**: The core high-performance transaction builder and lifecycle tracker.
2. **AI Agent Module (`agent/`)**: An autonomous decision engine that reasons about network state.
3. **Next.js Dashboard**: A judge-friendly visual interface for triggering runs and observing lifecycle evidence.

---

## 1. Core Transaction Stack (Rust)

The Rust engine (`engine/`) handles the critical path of transaction construction, Jito submission, and on-chain verification.

### High-Frequency Slot Polling (RPC)

- To preserve gRPC stream capacity under the SolInfra Ace Plan, slot tracking is performed by a background task that polls the `getSlot` RPC method every 400ms at the `Processed` commitment level.
- The latest slot is shared via an `Arc<AtomicU64>` and coordinated using `tokio::sync::Notify` to signal slot updates to the dashboard and submission loop. This guarantees that each bundle is stamped with the exact network slot at the time of construction (`submit_slot`).

The **single Ace-plan gRPC stream is reserved exclusively for transaction confirmation** (see Yellowstone section below). This is a deliberate architectural decision — not a limitation — to ensure the confirmation stream is always available and never contended.

### Leader Window Gating

Before constructing or submitting a bundle, the engine evaluates the current slot distance to the nearest scheduled Jito block-engine leader. Submission is held until `leaderDistanceSlots ≤ 2`, maximising the probability that the bundle reaches the block engine's auction queue during its active leader window.

The `wait_for_leader_window()` function polls the current slot (from `Arc<AtomicU64>`) against the known upcoming Jito leader schedule. If no leader-schedule data is available, submission proceeds immediately without blocking. This is consistent with the bounty requirement for leader-schedule-aware submission timing.

### Yellowstone gRPC Transaction Status Watcher

After a bundle is submitted, `geyser.rs` opens the Ace-plan gRPC connection to subscribe to `TransactionStatus` updates filtered by the exact transaction signature. This subscription uses `CommitmentLevel::Confirmed` and has a configurable timeout (default 25 seconds).

Because slot tracking has been moved to RPC polling, **this gRPC stream has no competitor** — it connects successfully on every run and provides the primary sub-second confirmation path.

When the target signature appears on-chain, the watcher returns a `StreamTxStatus` struct containing the slot, observation timestamp, and any execution errors. If the gRPC connection itself fails (network error, not stream contention), the lifecycle tracker falls back to RPC polling.

Our gRPC client integration is modeled after the official [Yellowstone gRPC Rust Examples](https://github.com/rpcpool/yellowstone-grpc/tree/master/examples/rust), leveraging the `yellowstone-grpc-client` crate to establish low-latency, resilient stream filters.

### Dynamic Tip Calculation

Before each bundle, the engine queries the Jito tip floor API:

```
GET https://bundles.jito.wtf/api/v1/bundles/tip_floor
```

It extracts the `landed_tips_75th_percentile` value (in SOL), converts it to lamports, and applies the following formula:

```
final_tip = max(FLOOR, p75_lamports)
final_tip = min(final_tip, CAP)
```

- **FLOOR**: 30,000 lamports — empirically proven minimum for reliable landing on mainnet. The public Jito tip API consistently underreports real landing cost (medians of 1k–5k lamports). Our mainnet testing established 30,000 lamports as the reliable floor.
- **CAP**: 100,000 lamports — budget protection ceiling.
- **Multiplier path**: On AI-directed retries, the agent outputs a `tipAdjustmentFactor` and the engine re-applies: `new_tip = min(current_tip * factor, CAP)`.

No tip value is hardcoded in the normal submission path — the live API drives every decision, with the floor as a safety net. If the API call fails, the engine falls back to the floor.

### Multi-Region Parallel Dispatch

The engine submits each bundle in parallel to **5 regional Jito block engines** simultaneously:

| Region | Endpoint |
|---|---|
| Global (primary) | `https://mainnet.block-engine.jito.wtf` |
| New York | `https://ny.mainnet.block-engine.jito.wtf` |
| Amsterdam | `https://amsterdam.mainnet.block-engine.jito.wtf` |
| Frankfurt | `https://frankfurt.mainnet.block-engine.jito.wtf` |
| Tokyo | `https://tokyo.mainnet.block-engine.jito.wtf` |

All 5 requests are dispatched concurrently via `tokio::join!` / `futures::future::join_all`. The first successful response (HTTP 200 with a valid `x-bundle-id` header) is used; the rest are discarded. This strategy materially reduces regional slot-auction miss rate, particularly when the current Jito leader is in a non-primary region.

### Transaction Construction and Submission

Each bundle consists of two instructions packed into a single Solana transaction:

1. **Memo Instruction**: Writes a diagnostic string (e.g., `"Sentry | bounty demo"`) via the SPL Memo program (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`), with the operator wallet as a signer.
2. **Tip Transfer**: A `SystemProgram::Transfer` instruction sending the calculated tip to a randomly-selected Jito tip account.

The Jito tip account is selected by first querying `getTipAccounts` from the Jito Block Engine RPC. If the query returns an empty list, the engine falls back to 8 hardcoded tip account addresses.

> **Key design decision — inline-tip single-transaction bundles**: The tip instruction and payload instruction are packed into the same transaction, not as separate `addTipTx()` calls. This is the only pattern that reliably landed on mainnet in our testing. Separate tip-transaction bundles were accepted (UUID returned) but never appeared on-chain.

The transaction is:
1. **Simulated** against Solana RPC (`simulateTransaction`) to validate instruction logic and compute units.
2. **Signed** with a fresh `confirmed`-commitment blockhash fetched via `getLatestBlockhash`.
3. **Serialized** to base64 using `bincode` + the standard base64 engine.
4. **Submitted** via `POST /api/v1/transactions` on the Jito Block Engine (using `sendTransaction`, not `sendBundle`).

The `x-bundle-id` HTTP response header is captured to uniquely identify the bundle for lifecycle tracking.

The submission includes an exponential backoff retry loop (up to 4 attempts) that handles Jito rate limiting (HTTP 429 or JSON-RPC error code `-32097`). Backoff delays are 2s, 4s, 6s, 8s.

> **`confirmed` commitment is non-negotiable**: The `finalized` commitment blockhash is already ~31 slots (~12.8 seconds) old by the time it is returned, consuming over 20% of the 150-slot validity window before the transaction is even signed. The stack enforces `confirmed` everywhere to preserve the maximum possible validity window.

### "Bundle UUID Does Not Mean On-Chain Inclusion"

This is the most important operational insight in our mainnet testing. Jito's block engine returns an HTTP 200 with an `x-bundle-id` UUID for every submitted bundle — **including bundles that lose the slot auction or fail simulation**. A UUID from Jito cannot be interpreted as confirmation of inclusion.

The engine resolves this via concurrent monitoring after submission:

- **`getInflightBundleStatuses`** (Jito side): Detects early Jito-side rejections (`Failed`, `Invalid`) before the transaction would ever appear on-chain. This surfaces the real rejection reason — not just "tip too low".
- **`getSignatureStatuses`** (Solana RPC): The authoritative source. A bundle confirmed here is genuinely on-chain.

A bundle that receives a UUID but is confirmed by neither source within 45 seconds is classified as `BUNDLE_FAILURE` and escalated to the AI agent.

### Multi-Stage Lifecycle Tracking

After submission, `lifecycle.rs::track_bundle()` runs a polling loop (default: 15 polls, 4-second intervals = 60 seconds max) that simultaneously queries two sources:

**Solana RPC (`getSignatureStatuses`)**:
- Records timestamps at each commitment level transition:
  - `processed_at`: First observation by the validator
  - `confirmed_at`: Supermajority (66%+) validator vote ratification
  - `finalized_at`: Block becomes irreversible
- Calculates latency deltas between each transition
- Marks the bundle as `Landed` once `Confirmed` is reached

**Jito Inflight Status (`getInflightBundleStatuses`)**:
- Checked concurrently before the transaction appears in Solana RPC
- Detects early Jito-side rejections (`Failed`, `Invalid`) before they would ever appear on-chain
- Reports `Landed` with slot information if Jito has already confirmed it

### Failure Handling Strategy

Every non-landed bundle is classified and escalated. The complete failure handling matrix:

| Failure Class | Detection Mechanism | Recovery Path |
|---|---|---|
| `EXPIRED_BLOCKHASH` | Fault injection (`Hash::default()`) or RPC preflight rejection | AI → `retry` with fresh `confirmed` blockhash |
| `BUNDLE_FAILURE` | `getInflightBundleStatuses` returns `Failed`/`Invalid`, or no on-chain confirmation within 45s | AI → `retry` with tip increase via `tipAdjustmentFactor` |
| `ZERO_TIP` | Jito rejects bundles below its minimum tip threshold | Classified and logged as intentional failure evidence |
| `SIMULATION_FAILURE` | `simulateTransaction` returns an error before submission | Logged with full simulation error logs; does not reach block engine |
| `RATE_LIMIT_EXHAUSTED` | HTTP 429 or JSON-RPC `-32097` after all retry attempts | Exponential backoff (2s/4s/6s/8s); fail if exhausted |
| `RPC_FAILURE` | Yellowstone gRPC stream timeout | Automatic fallback to `getSignatureStatuses` polling; no submission interruption |

> **Key insight**: Jito returns HTTP 200 + bundle UUID even when the bundle loses the slot auction. Our stack treats "accepted but not on-chain within 45s" as `BUNDLE_FAILURE` and escalates to the AI operator — the block engine's optimism is not treated as a guarantee.

### Autonomous Retry Logic

When a non-intentional failure occurs (the bundle was not an injected fault test), the engine automatically:

1. Fetches a fresh `confirmed`-commitment blockhash via `getLatestBlockhash`
2. Recalculates the live tip from the Jito tip floor API (with optional AI-directed `tipAdjustmentFactor`)
3. Rebuilds and resubmits the bundle
4. Runs the full lifecycle tracking on the retry

The retry result is logged as a separate JSONL entry with a `recovery` field describing the original failure and the retry parameters.

### Failure Injection

The engine supports two intentional failure modes for testing the failure classification system:

| Mode | Trigger | Behavior |
|---|---|---|
| `zero-tip` | `FAIL_TEST=zero-tip` | Sets tip to 0 lamports. Jito requires nonzero tips, so the bundle is rejected. |
| `expired-hash` | `FAIL_TEST=expired-hash` | Uses `Hash::default()` (all zeros) as the blockhash. Solana simulation fails immediately with `BlockhashNotFound`. |

**What the fault injection proves**: Both modes produce real on-chain-verifiable rejected states — not synthetic exceptions. The `expired-hash` mode mimics what happens in production when blockhash expiry occurs organically (e.g., after network congestion delays the submission). The `zero-tip` mode proves that Jito's tip floor enforcement is real and consistently applied. The AI agent is invoked after detection in both cases, reasons about the failure class, and outputs a recovery directive — validating the full detect → classify → reason → decide → retry loop.

### Failure Classification

Every non-landed bundle is tagged with structured metadata:

| Field | Description |
|---|---|
| `failure_type` | Machine-readable category: `zero_tip`, `blockhash_expired`, `rate_limit_exhausted`, `jito_rejection`, `simulation_failure`, `on_chain_error`, `confirmation_timeout`, `not_landed`, `build_error`, `stream_observed_on_chain_error` |
| `failure_stage` | Where the failure occurred: `tip_calculation`, `pre_submission`, `submission`, `block_engine`, `execution`, `confirmation`, `yellowstone_transaction_status`, `pre-tracking` |
| `recovery` | Human-readable recovery guidance |

### Log Output

The engine writes JSONL telemetry to two locations simultaneously:

```
engine/lifecycle_log.jsonl    (engine-local)
logs/lifecycle_log.jsonl      (project-level, for dashboard consumption)
```

Each line is a serialized `BundleRun` struct containing: `bundle_id`, `signature`, `tip_lamports`, `tip_account`, `status`, `submitted_at`, `landed_at`, `error_reason`, `run_number`, `submit_slot`, `landed_slot`, `processed_at`, `confirmed_at`, `finalized_at`, `confirmation_source`, `failure_type`, `failure_stage`, `recovery`.

### Rust Dependencies

| Crate | Version | Purpose |
|---|---|---|
| `yellowstone-grpc-client` | v12.1.0+solana.3.1.9 | gRPC client for Yellowstone validator streams |
| `yellowstone-grpc-proto` | v12.1.0+solana.3.1.9 | Protobuf definitions for Yellowstone messages |
| `solana-sdk` | 2.2.x | Core Solana primitives (keypairs, instructions, transactions) |
| `solana-rpc-client` | 2.2.x | RPC client for `getSlot`, `getLatestBlockhash`, `simulateTransaction` |
| `tokio` | 1.x | Async runtime with multi-thread scheduler |
| `reqwest` | 0.12 | HTTP client for Jito block engine and tip floor API |
| `serde_json` | 1.x | JSON serialization for RPC payloads and JSONL log output |
| `bincode` | 1.x | Binary serialization for Solana transactions |
| `tracing` | 0.1 | Structured logging |

---

## 2. Autonomous AI Agent Layer

The AI Agent (`agent/src/index.ts`) is cleanly separated from the core transaction stack. It operates as an asynchronous observer and decision-maker.

### State Ingestion

The agent reads:

1. The `lifecycle_log.jsonl` produced by the Rust engine.
2. Live Jito tip percentiles.
3. Live network slot data.

### Reasoning Engine

The agent analyzes the state to determine:

- `landedRate`: The success rate of recent bundles.
- `avgDeltaMs`: The median latency between `Processed` and `Confirmed` (indicating network congestion).
- `failureTypes`: Patterns of recent failures (e.g., rate limits, blockhash expiries).

### Decision Output

The agent selects one of three operational actions:

- **`submit`**: The default action. If congestion is detected (high `avgDeltaMs`), the agent automatically recommends a tip premium above the p75 floor.
- **`retry`**: Triggered if recent submissions failed due to recoverable errors like blockhash expiry. The agent increases the tip and directs the stack to use a fresh blockhash.
- **`hold`**: Triggered if the `landedRate` is critically low (sustained failure state), preventing wasted transaction fees.

### LLM Chain

The agent prefers a local reasoning policy for speed and reliability, but can be configured to consult a Groq LLM chain (e.g., `llama-3.3-70b-versatile`) to interpret complex failure patterns and output a structured JSON decision.

---

## 3. Dashboard Interface

The Next.js dashboard provides real-time visibility into the infrastructure:

- **Lifecycle Lane**: Visualizes the transaction's progression from `Submitted` -> `Processed` -> `Confirmed` -> `Finalized`.
- **Run Evidence**: A tabular log of every run, showing submit/landed slots, tip amounts, and failure classifications.
- **Agent Reasoning**: Displays the AI agent's chosen action, recommended tip, confidence score, and plain-english reasoning based on observed network risk.
- **Evidence Export**: Generates a Markdown report containing the full lifecycle log and latency medians for bounty submission.

---

## 4. Developer Integration (Programmatic SDK & REST API)

To support integration into external dApps, searchers, or trading bots, Sentry includes a programmatic SDK and a standalone REST API server.

### 4.1 Programmatic TypeScript SDK (`lib/sentry-sdk.ts`)

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

### 4.2 Standalone REST API Server (`server.ts`)

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

## 5. Mainnet Validation Test Harnesses (`scripts/harnesses/`)

Sentry includes 6 standalone test scripts in `scripts/harnesses/` to validate all pipeline layers against live Solana mainnet conditions:

| Script | Command | Purpose |
|---|---|---|
| `harness_faults.ts` | `npm run harness:faults` | Simulates standard execution (using a 1,000-lamport self-transfer to bypass Solana rent-exemption floors), zero tip failures, blockhash expirations, and simulation errors with AI reasoning console logs. |
| `harness_trader.ts` | `npm run harness:trader` | Simulates swapping SOL ⇄ USDC via Jupiter API, demonstrating quote expiry, slippage boundary breaches, and Jito leader skips. |
| `harness_requote.ts` | `npm run harness:requote` | Demonstrates that Sentry does not blindly fail on slippage; instead, it re-quotes fresh swap routes via Jupiter, re-signs, and submits. |
| `harness_sniper.ts` | `npm run harness:sniper` | Models liquidity pool detection, route lookup, high-congestion tip, and +1 slot bundle sniping. |
| `harness_budget.ts` | `npm run harness:budget` | Enforces a session budget cap; the AI holds/aborts when upcoming tip requirements exceed remaining pool limits. |
| `harness_mev.ts` | `npm run harness:mev` | Audits MEV exposure, showing side-by-side transaction cost and searcher frontrun/backrun risk comparison (Public Route vs. Jito Bundle). |

