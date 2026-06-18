---
sidebar_position: 1
---
# System Overview

## 1. Introduction
Sentry is a secure, low latency Solana transaction operations stack. It is engineered to build and execute Solana transactions as Jito bundles, track their lifecycle status across multiple network commitment states in real time, and make automated, dynamic tipping decisions using a localized AI decision agent.

Standard Solana RPC pipelines suffer from lack of landing predictability under high congestion, transaction loss, and delayed lifecycle status visibility. Sentry solves this by bypassing public mempools via Jito, streaming slots directly from high performance gRPC providers, and using an observer agent that acts as an autonomous systems operator.

### Core Features
* Yellowstone gRPC streaming of Processed blocks for real-time slot alignment
* Inflight bundle status tracking via Jito Engine WebSocket and REST endpoints
* Multi-stage latency diagnostics (Processed → Confirmed → Finalized)
* Dynamic tip calculations with budget safety limits (30k lamport floor)
* Autonomous local rules policy and backup LLM decision agent
* Unified Command Line interface with a persistent REPL console

## 2. Setup & Installation

### Prerequisites
To build and run Sentry locally, verify you have the following toolchains installed on your host system:
* **Node.js**: v18 or higher installed. npm is required for Next.js and the agent.
* **Rust & Cargo**: Stable toolchain installed. Necessary to build the engine.
* **Docker Engine**: Recommended for container orchestration.

### Environment Configuration
Configure your environment by setting up the necessary keys and endpoint parameters. Create a `.env` file in the project root:

```env
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WSS_URL=wss://api.mainnet-beta.solana.com
YELLOWSTONE_GRPC_URL=https://grpc.solinfra.dev
YELLOWSTONE_GRPC_TOKEN=your_solinfra_grpc_auth_token
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
GROQ_API_KEY=gsk_your_groq_api_key_here
ENGINE_PAYER_KEYPAIR=[122,94,84,33,...]
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
