# Smart Transaction Observatory

A Solana infrastructure project for the Superteam Nigeria **Advanced Infrastructure Challenge: Build a Smart Transaction Stack** bounty.

The observatory is a full-stack transaction operations system. It streams live Solana network state, builds and submits Jito-powered mainnet transactions, tracks each submission through its lifecycle, and presents the result in a judge-friendly dashboard.

## Current Status

- Rust engine loads the funded bounty wallet and checks mainnet balance.
- Yellowstone gRPC slot streaming is implemented in `engine/src/geyser.rs`.
- Jito transaction submission is implemented in `engine/src/jito.rs`.
- Dynamic tip selection reads Jito's tip floor API and uses the 75th percentile with a floor and cap.
- Jito tip accounts are fetched through `getTipAccounts`, with a fallback account list for rate-limited responses.
- Lifecycle tracking polls Solana RPC signature status and Jito inflight bundle status.
- Dashboard UI is being built in Next.js with a minimalist black-and-white metallic brutalist style.

## Architecture

```text
Rust Engine
  -> Yellowstone gRPC slot stream
  -> Jito tip intelligence
  -> Memo transaction builder
  -> Jito sendTransaction submission
  -> Lifecycle tracker
  -> lifecycle_log.jsonl

TypeScript Agent
  -> Autonomous decision layer
  -> Tip or retry reasoning
  -> Dashboard bridge

Next.js Dashboard
  -> Live network status
  -> Submit Bundle action
  -> AI reasoning panel
  -> Lifecycle timeline
  -> Verifiable run evidence
```

## What To Use For Jito

Use Jito's Block Engine HTTP JSON-RPC endpoints:

- `getTipAccounts` from `/api/v1/bundles`
- `sendTransaction` from `/api/v1/transactions`
- `getInflightBundleStatuses` for short-window lifecycle checks
- `https://bundles.jito.wtf/api/v1/bundles/tip_floor` for live tip floor data

This project currently uses `sendTransaction` instead of raw `sendBundle`. Jito accepts the base64-encoded signed Solana transaction and returns the transaction signature in the JSON response. The bundle id is captured from the `x-bundle-id` response header.

## Real Run Evidence

The latest observed run landed 5 consecutive mainnet bundle submissions before the process was manually stopped:

| Run | Status | Tip | Notes |
| --- | --- | --- | --- |
| 1 | Landed | 30,000 lamports | Confirmed by Solana RPC |
| 2 | Landed | 30,000 lamports | Confirmed by Solana RPC |
| 3 | Landed | 77,451 lamports | Jito tip account endpoint was rate limited, fallback account used |
| 4 | Landed | 30,000 lamports | Confirmed by Solana RPC |
| 5 | Landed | 30,000 lamports | Confirmed by Solana RPC |

The full bounty target is 12 runs: 10 normal submissions and 2 intentional failure cases for lifecycle classification.

## Running The Engine

Create `.env` with the required RPC, Yellowstone, Jito, and wallet values, then run:

```bash
cd engine
cargo run
```

The engine writes lifecycle output to:

```text
engine/lifecycle_log.jsonl
```

## Running The Dashboard

```bash
npm run dev
```

Then open the local Next.js URL printed by the dev server.

## Bounty Checklist

- [x] Mainnet wallet funded
- [x] Yellowstone gRPC stream implemented
- [x] Jito transaction construction implemented
- [x] Dynamic tip calculation implemented
- [x] Lifecycle tracking implemented
- [ ] 10 successful verifiable submissions
- [ ] 2 intentional failures logged and classified
- [ ] AI agent autonomous decision wired into runtime
- [ ] Public architecture document
- [ ] Final README technical observations
