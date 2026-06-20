---
sidebar_position: 1
---
# System Overview

## 1. Introduction
Sentry is a secure, low latency Solana transaction operations stack. It is engineered to build and execute Solana transactions as Jito bundles, track their lifecycle status across multiple network commitment states in real time, and make automated, dynamic tipping decisions using a localized AI decision agent.

Standard Solana RPC pipelines suffer from lack of landing predictability under high congestion, transaction loss, and delayed lifecycle status visibility. Sentry solves this by bypassing public mempools via Jito, streaming slots directly from high performance gRPC providers, and using an observer agent that acts as an autonomous systems operator.

### Core Features
* High-frequency RPC polling for real-time slot tracking and alignment
* Yellowstone gRPC stream subscription for direct transaction confirmation
* Inflight bundle status tracking via Jito Engine WebSocket and REST endpoints
* Multi-stage latency diagnostics (Processed → Confirmed → Finalized)
* Dynamic tip calculations with budget safety limits (30k lamport floor)
* Autonomous local rules policy and backup LLM decision agent
* Unified Command Line interface with a persistent REPL console

## 2. Setup & Installation

Before running the stack, ensure the following tools are installed on your system:

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 18+ | Dashboard, Agent, CLI, Docs |
| Rust + Cargo | Stable | Engine compilation |
| Docker + Compose | Any recent | Containerized orchestration |
| protobuf-compiler | Any | Yellowstone gRPC proto compilation |


### Environment Configuration
Configure your environment by setting up the necessary keys and endpoint parameters. Create a `.env` file in the project root:

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
YELLOWSTONE_ENDPOINT=https://grpc.solinfra.dev
YELLOWSTONE_TOKEN=your_solinfra_api_key_here
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
GROQ_API_KEY=gsk_your_groq_api_key_here
WALLET_PRIVATE_KEY=[122,94,84,33,...]
```
 
**Infrastructure Providers**
Yellowstone gRPC streaming requires access to a specialized Solana validator stream. Sentry is designed to interface with gRPC services like [SolInfra](https://solinfra.dev/). Ensure you paste your authorized connection token in the URL or in the token header variables.

### Service Bootstrapping
To launch the complete pipeline locally, install dependencies in the root folder, link the command line utility, and execute the run command:

```bash
npm install
npm link
sentry run
```
