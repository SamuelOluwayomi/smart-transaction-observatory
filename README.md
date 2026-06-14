# Smart Transaction Observatory

A Solana infrastructure project for the Superteam Nigeria **Advanced Infrastructure Challenge: Build a Smart Transaction Stack** bounty.

The observatory is a full-stack transaction operations system. It streams live Solana network state, builds and submits Jito-powered mainnet transactions, tracks each submission through its multi-stage commitment lifecycle, and utilizes an autonomous AI agent to make tip and retry decisions based on network risk.

## Live Demo & Walkthrough

Check out the interactive dashboard, execution logs, and landing flow in action:

- **Demo Video & Status Update**: [https://x.com/The_devsam/status/2065806306946981923?s=20](https://x.com/The_devsam/status/2065806306946981923?s=20)

---

## Current Status & Bounty Features

- **Yellowstone gRPC Integration & Concurrency Design**:
  - The codebase utilizes a background task to maintain a live connection to the Yellowstone gRPC stream, subscribing to slot updates at the `Processed` commitment level.
  - Due to standard gRPC infrastructure tier limits (e.g., Solinfra's Ace/Free plans limiting accounts to exactly **1 concurrent gRPC stream**), this single connection is fully dedicated to the live slot stream background task (`run_slot_stream()`).
  - To prevent stream exhaustion errors from blocking transaction confirmations, the engine is designed with a **robust fallback path**: if a secondary gRPC watcher stream is blocked due to the 1-stream tier limit, the engine automatically falls back to HTTP RPC polling (`getSignatureStatuses`) to track the multi-stage commitment levels (`Processed` -> `Confirmed` -> `Finalized`), ensuring no logs or confirmations are lost.
- **Multi-Stage Lifecycle Tracking**: The engine polls each commitment level individually (`Processed` -> `Confirmed` -> `Finalized`), recording timestamps and calculating the latency deltas between stages.
- **Autonomous AI Agent Layer**: A cleanly separated `agent/` module reads the lifecycle log, analyzes Jito tip floors and network congestion, and makes autonomous `submit`/`hold`/`retry` decisions with visible risk reasoning.
- **Dynamic Tip Selection**: Base tips are selected from the 75th percentile of Jito's live tip floor API, with automatic premiums added by the AI agent during high-latency periods.
- **Autonomous Retry**: Built-in recovery loops that fetch a fresh blockhash and recalculate tips for expired or failed bundles.
- **Failure Classification**: Categorizes errors (e.g., `rate_limit_exhausted`, `jito_rejection`, `blockhash_expired`) and provides clear recovery steps.
- **Verifiable Evidence**: Generates a judge-ready Markdown export with run links, slots, commitment deltas, and AI decisions.

---

## Architecture

Please see the [Architecture Document](ARCHITECTURE.md) for a detailed breakdown of the system components.

_Note for Bounty Submission: The contents of `ARCHITECTURE.md` should be copied to a public Notion or Google Doc and linked here to fully satisfy the "publicly hosted architecture document" requirement._

---

## Testing Modes (Local vs Daemon)

The project supports two testing workflows for developers:

### Mode A: Web-Only Testing (Local)

If you want to test the frontend UI buttons, inspect the layouts, or interact with the AI chat model:

1. Run the Next.js server locally.
2. Click **Submit Bundle** directly on the dashboard.
3. The server-side API handler in Node/TS (`lib/observatory.ts`) will build and submit the transaction via Jito's HTTP RPC, and confirm landing using an RPC Polling Fallback loop (`getSignatureStatuses`).

### Mode B: Full Infrastructure Daemon (Rust Engine)

To run the full 12-run cycle, verify Yellowstone gRPC stream connectivity, and log the final required lifecycle data:

1. Run `cargo run` inside the `engine/` directory.
2. The Rust daemon maintains a persistent Yellowstone stream connection to catch slot updates.
3. Transactions are signed and submitted as Jito bundles, and their landing is verified using the Yellowstone gRPC stream (falling back to RPC on stream limits).
4. The dashboard UI will read from the generated logs and dynamically refresh the tables in real-time.

---

## Bounty Technical Questions

Based on the operational evidence gathered by this stack, here are the answers to the three mandatory bounty questions:

### Q1: What does the delta between processed_at and confirmed_at tell you?

The delta between `Processed` and `Confirmed` represents the time it takes for a supermajority (66%+) of the Solana validator network to vote on and ratify the block containing the transaction.

- **Low Delta (e.g., 400-800ms)**: Indicates a healthy, highly responsive network with fast vote propagation.
- **High Delta (e.g., >2000ms)**: Indicates network congestion, validator fork resolution, or heavy voting load. In our stack, the AI Agent monitors this delta; if the median latency spikes, the agent autonomously increases the Jito tip premium to prioritize our bundles during the congestion.

### Q2: Why should you never use finalized commitment for your blockhash in time-sensitive transactions?

A blockhash remains valid for exactly 150 slots. By using a `Finalized` blockhash (which is already ~32 slots or ~12.8 seconds old by the time you fetch it), you are artificially shortening the validity window of your transaction by roughly 20%. In time-sensitive operations, every second counts. Using a `Confirmed` or `Processed` blockhash ensures you have the maximum possible runway (the full 150 slots) for your transaction to land and be retried if necessary before it expires.

### Q3: What happens to your bundle if the Jito leader skips their slot?

If the targeted Jito leader skips their slot, the Jito Block Engine will drop the bundle, and the transaction will not land in that specific slot. However, because Jito validators make up a large percentage of the network (often back-to-back in the leader schedule), the Jito Block Engine can automatically forward the bundle to the _next_ available Jito leader, provided the transaction's blockhash is still valid. If the blockhash expires during a prolonged sequence of skipped slots or non-Jito leaders, the bundle will ultimately fail and our stack's auto-retry mechanism will kick in to fetch a fresh blockhash.

---

## What To Use For Jito

Use Jito's Block Engine HTTP JSON-RPC endpoints:

- `getTipAccounts` from `/api/v1/bundles`
- `sendTransaction` from `/api/v1/transactions`
- `getInflightBundleStatuses` for short-window lifecycle checks
- `https://bundles.jito.wtf/api/v1/bundles/tip_floor` for live tip floor data

This project uses `sendTransaction` instead of raw `sendBundle`. Jito accepts the base64-encoded signed Solana transaction, automatically wraps it in a bundle, and returns the transaction signature in the JSON response. The `bundle_id` is captured from the `x-bundle-id` response header.

---

## Running The Engine

Create `.env` with the required RPC, Yellowstone, Jito, and wallet values, then run:

```bash
cd engine
cargo run
```

The engine runs the full 12-bundle cycle (10 normal + 2 intentional failures) and writes lifecycle output to:

```text
engine/lifecycle_log.jsonl
logs/lifecycle_log.jsonl
```

## Running The Agent

The AI agent runs as a standalone process, observing the engine's output:

```bash
cd agent
npm install
npm start
```

## Running The Dashboard

```bash
npm run dev
```

Then open the local Next.js URL printed by the dev server.

The dashboard expects these environment variables in `.env` or `engine/.env`:

```text
SOLANA_RPC_URL=
WALLET_PRIVATE_KEY=
JITO_BLOCK_ENGINE_URL=
GROQ_API_KEY=
YELLOWSTONE_ENDPOINT=
YELLOWSTONE_TOKEN=
```

## Dashboard APIs

- `GET /api/observatory`: current Solana slot, wallet balance, Jito tip floor, multi-stage lifecycle log summary, and latest AI decision.
- `POST /api/submit-bundle`: asks the Groq agent for a decision, submits a memo transaction through Jito when the action is not `hold`, polls multi-stage confirmation status, and appends the result to the log.
- `GET /api/evidence`: exports a Markdown evidence report for bounty submission.

---

## Bounty Checklist

- [x] Mainnet wallet funded
- [x] Yellowstone gRPC stream implemented and actively sharing `submit_slot`
- [x] Jito transaction construction implemented via `sendTransaction`
- [x] Dynamic tip calculation implemented (p75 with floor/cap)
- [x] Multi-stage lifecycle tracking implemented (Processed -> Confirmed -> Finalized)
- [x] AI agent autonomous decision wired into runtime (standalone `agent/` module)
- [x] Automatic retry with blockhash refresh on failure
- [x] Public architecture document created (`ARCHITECTURE.md`)
- [x] Final README technical observations answered (Q1, Q2, Q3)
- [ ] 10 successful verifiable submissions (Run the engine)
- [ ] 2 intentional failures logged and classified (Run the engine)
