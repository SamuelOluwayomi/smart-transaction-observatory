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

### Yellowstone gRPC Slot Streaming

- A background task maintains a live connection to a Yellowstone gRPC endpoint.
- It subscribes to slot updates at the `Processed` commitment level.
- The latest slot is shared via an `Arc<AtomicU64>` with the main submission loop, ensuring every bundle is stamped with the exact network slot at the time of submission (`submit_slot`).

### Dynamic Tip Calculation

- Before building a transaction, the engine queries the Jito tip floor API (`https://bundles.jito.wtf/api/v1/bundles/tip_floor`).
- It extracts the `landed_tips_75th_percentile` to ensure competitive inclusion.
- Tips are clamped between a 30,000 lamport floor (to avoid outright rejection) and a 100,000 lamport cap (budget protection).

### Transaction Construction & Submission

- The engine uses the `sendTransaction` RPC method on the Jito Block Engine (`/api/v1/transactions`).
- Transactions are base64-encoded to prevent formatting issues.
- The `x-bundle-id` header is extracted from the HTTP response to uniquely identify the bundle for lifecycle tracking.

### Multi-Stage Lifecycle Tracking

- **RPC Polling**: The engine polls `getSignatureStatuses` on the Solana RPC to track the transaction as it progresses through `Processed` -> `Confirmed` -> `Finalized` commitment levels.
- **Jito Inflight Status**: Concurrently, it polls `getInflightBundleStatuses` on the Jito Block Engine to detect early rejections (e.g., `Failed` or `Invalid`) before they would ever appear on-chain.
- **Latency Deltas**: Timestamps are recorded at each commitment transition, calculating the `Processed -> Confirmed` and `Confirmed -> Finalized` latency deltas.

### Autonomous Retry & Failure Injection

- **Intentional Failures**: For testing, the engine can inject intentional faults (e.g., a 0 lamport tip or an impossible transfer) to prove the failure classification system works.
- **Auto-Retry**: On non-intentional failures (e.g., blockhash expiry), the engine autonomously fetches a fresh blockhash, recalculates the live tip, and resubmits the bundle.

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
