# Sentry: Smart Transaction Stack

A Solana infrastructure project built for the Superteam Nigeria Advanced Infrastructure Challenge: Build a Smart Transaction Stack bounty.

Sentry is a full-stack transaction operations system. It streams live Solana network state, builds and submits Jito-powered mainnet transactions, tracks each submission through its multi-stage commitment lifecycle, and utilizes an autonomous AI agent to make tip and retry decisions based on network risk.

## Project Resources

- **Live Documentation**: [https://sentry-doc.vercel.app/](https://sentry-doc.vercel.app/)
- **GitHub Repository**: [https://github.com/SamuelOluwayomi/smart-transaction-observatory](https://github.com/SamuelOluwayomi/smart-transaction-observatory)
- **Demo Video & Status Update**: [https://x.com/The_devsam/status/2065806306946981923?s=20](https://x.com/The_devsam/status/2065806306946981923?s=20)

---

## Core System Architecture

Sentry consists of four decoupled services orchestrating the transaction pipeline:

1. **Rust Engine** (`engine/`): A high-performance daemon written in Rust. It maintains a persistent Yellowstone gRPC connection to stream slot updates, constructs signed transaction payloads wrapped as Jito bundles, applies base tip calculations, monitors transaction signatures, and logs multi-stage commitment timestamps. It includes an automatic HTTP JSON-RPC polling fallback in case gRPC rate limits are reached.
2. **AI Agent Daemon** (`agent/`): A standalone Node.js process that monitors the engine's telemetry logs. It analyzes historical latency, Jito tip floors, and network congestion using a local rules engine and a Groq LLM (llama-3.3-70b-versatile) to make autonomous decisions (submit, hold, or retry with tipping premium adjustments).
3. **Next.js Web Console** (`app/`): A real-time monitoring dashboard served on port 3000. It reads execution logs, tracks wallet balances, displays Jito tip floor percentiles, streams slots via Server-Sent Events (SSE), and hosts an interactive AI documentation assistant.
4. **Docusaurus Documentation Site** (`docs/`): A developer handbook served on port 3001 and deployed to Vercel. It outlines system architecture, failure classification tables, CLI commands, and features a cross-origin AI Chat assistant that queries Sentry's backend routes.

---

## Infrastructure Integrations

### SolInfra

SolInfra is the primary high-performance infrastructure provider utilized in Sentry. It is configured to run behind a single API key, supplying:

- **Reserved RPC capacity**: Dedicated RPC capacity preventing unexpected public endpoint throttling for critical operations such as blockhash fetching and signature verification.
- **Yellowstone gRPC streaming**: Sub-millisecond validator event delivery bypassing public mempools.
- **PAYG Billing Model**: A pay-as-you-go bytes-based billing system that optimizes operational costs.

#### How Sentry Uses SolInfra
1. **Live Slot Pulse**: The Rust engine opens a gRPC slot subscription at the `Processed` level. These slot notifications are cached in memory to stamp bundle submissions and feed the dashboard's real-time Slot Pulse panel.
2. **Commitment Lifecycle Telemetry**: Upon submitting a bundle to Jito, the engine opens a gRPC transaction subscription to capture exact timestamps when the transaction hits `Processed`, `Confirmed`, and `Finalized` levels, enabling microsecond-precision latency analytics.

---

## Setup & Installation

### Prerequisites

Ensure you have the following toolchains installed:
- **Node.js**: Version 18 or higher (with npm)
- **Rust & Cargo**: Stable Rust toolchain
- **Docker & Docker Compose**: For containerized orchestration

### Environment Configuration

Create a `.env` file at the root of the project (and copy/link to `engine/.env` where appropriate) containing the following parameters:

```env
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WSS_URL=wss://api.mainnet-beta.solana.com
YELLOWSTONE_ENDPOINT=https://grpc.solinfra.dev
YELLOWSTONE_TOKEN=your_solinfra_api_key_here
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
GROQ_API_KEY=gsk_your_groq_api_key_here
WALLET_PRIVATE_KEY=[122,94,84,33,...]
```

*Note: The Next.js dashboard, CLI, and Rust engine resolve `YELLOWSTONE_ENDPOINT` and `YELLOWSTONE_TOKEN` directly for SolInfra's gRPC connection.*

### Local Installation & Dev Run

Initialize project packages and link the CLI executable globally:

```bash
npm install
npm link
```

Launch the entire stack (Dashboard, Engine, Agent, and Docs) concurrently:

```bash
sentry run
```

---

## Command-Line Interface (`sentry`)

Sentry features a unified command-line utility accessible via `sentry` (after running `npm link`). It supports two execution workflows:

### 1. Interactive REPL Mode

Launch the operator console by running the executable without arguments:

```bash
sentry
```

Inside the persistent prompt, enter any command. The prompt returns after executing non-blocking commands, or when blocking daemons are exited using Ctrl+C:

```text
sentry> status          # Snapshot of live slot, balance, and last runs
sentry> analyze         # Run mathematical telemetry audits and AI insights
sentry> ask "why did run 6 fail?"
sentry> docs            # Starts the Docusaurus documentation site
sentry> run             # Spins up all 4 pipeline services concurrently
sentry> exit
```

### 2. One-Shot Mode

Run commands directly for automation scripts or Docker use:

```bash
sentry status
sentry analyze
sentry evidence
sentry verify <signature>
sentry fail-test zero-tip
sentry fail-test expired-hash
sentry run --count 10
sentry docs
sentry engine
sentry agent
sentry dashboard
sentry docker-up
```

---

## CLI Command Reference

| Command | Description |
|---|---|
| `status` | Print real-time pipeline state (network slot, balance, runs, AI decisions) |
| `evidence` | Calculate latency statistics and compile a judge-ready markdown verification report |
| `ask [query]` | Ask the AI agent a question or open an interactive terminal chat session |
| `analyze` | Generate an autonomous system diagnostic audit report |
| `verify <sig>` | Audit transaction slot, fee, and memos directly on-chain via RPC |
| `run [--count N]` | Start all 4 services concurrently (Dashboard, Engine, Agent, Docs) |
| `fail-test <type>`| Inject failure runs to verify AI classification (`zero-tip` or `expired-hash`) |
| `engine` | Compile and run the Rust bundle submission engine daemon |
| `agent` | Run the Node.js AI agent reasoning daemon |
| `dashboard` | Start the Next.js monitoring dashboard console (Port 3000) |
| `docs` | Start the Docusaurus documentation site locally (Port 3001) |
| `docker-up` | Spin up the complete containerized stack via Docker Compose |

---

## Docker Orchestration

The Sentry stack is containerized with Docker. A shared docker volume binds directories to sync logs and agent decisions across containers dynamically.

To start the Docker stack:

```bash
sentry docker-up
```

Or run natively:

```bash
docker compose up --build
```

The Next.js dashboard will be accessible at `http://localhost:3000`.

---

## Bounty Technical Questions

### Q1: What does the delta between processed_at and confirmed_at tell you?

The delta between `Processed` and `Confirmed` represents the time it takes for a supermajority (66%+) of the Solana validator network to vote on and ratify the block containing the transaction.

- **Low Delta (e.g., 400-800ms)**: Indicates a healthy, highly responsive network with fast vote propagation.
- **High Delta (e.g., >2000ms)**: Indicates network congestion, validator fork resolution, or heavy voting load. In our stack, the AI Agent monitors this delta; if the median latency spikes, the agent autonomously increases the Jito tip premium to prioritize our bundles during the congestion.

### Q2: Why should you never use finalized commitment for your blockhash in time-sensitive transactions?

A blockhash remains valid for exactly 150 slots. By using a `Finalized` blockhash (which is already ~32 slots or ~12.8 seconds old by the time you fetch it), you are artificially shortening the validity window of your transaction by roughly 20%. In time-sensitive operations, every second counts. Using a `Confirmed` or `Processed` blockhash ensures you have the maximum possible runway (the full 150 slots) for your transaction to land and be retried if necessary before it expires.

### Q3: What happens to your bundle if the Jito leader skips their slot?

If the targeted Jito leader skips their slot, the Jito Block Engine will drop the bundle, and the transaction will not land in that specific slot. However, because Jito validators make up a large percentage of the network (often back-to-back in the leader schedule), the Jito Block Engine can automatically forward the bundle to the next available Jito leader, provided the transaction's blockhash is still valid. If the blockhash expires during a prolonged sequence of skipped slots or non-Jito leaders, the bundle will ultimately fail and our stack's auto-retry mechanism will kick in to fetch a fresh blockhash.

---

## Dashboard APIs

- `GET /api/observatory`: Returns live network slot, wallet balance, Jito tip percentiles, run logs, and the latest AI decisions.
- `GET /api/slots/stream`: Server-Sent Events (SSE) route streaming real-time slot and timestamp data.
- `POST /api/submit-bundle/stream`: Triggers engine run and streams CLI-like progress logs (dynamic tip sizing, signature generation, landing status).
- `POST /api/docs/chat`: Direct chat router with Groq, configured with CORS support to interface with Vercel-hosted docs.

---

## Telemetry Checklist

- [x] Mainnet wallet funded and validated.
- [x] Yellowstone gRPC stream active and tracking Processed slot intervals.
- [x] Jito bundle submission executing via JSON-RPC sendTransaction.
- [x] Dynamic Jito tips referencing 75th percentile floors with caps.
- [x] Telemetry capturing three-stage commitment levels (Processed, Confirmed, Finalized).
- [x] Autonomous Node.js AI agent resolving pipeline decisions.
- [x] Auto-retry blockhash loops active on expired transaction slots.
- [x] Verified and formatted system architecture document.
- [x] Bounty question technical audits documented.
- [ ] 10 successful live runs processed through the Rust engine.
- [ ] 2 intentional failure runs classified (`zero-tip`, `expired-hash`).
