---
sidebar_position: 4
---
# CLI & API Reference

## 5. Sentry CLI & REPL
Sentry comes packaged with a command-line binary. Once linked globally with `npm link`, it can be run using the `sentry` command.

### Operator CLI Reference
Sentry CLI supports one-shot command execution for dev scripting and automated cron tasks:

| Command | Description |
|---|---|
| `sentry run` | Launches all daemon processes concurrently (Dashboard, Engine, and Agent). Supports `--count [N]` parameter. |
| `sentry status` | Displays live node slot, wallet balances, and summaries of recent bundle submissions. |
| `sentry analyze` | Performs a mathematical audit of transaction logs and generates an AI operator summary. |
| `sentry fail test [type]` | Injects deliberate transaction failures (`zero tip` or `expired blockhash`) into the logs. |
| `sentry verify [sig]` | Audits a specific transaction signature directly on the Solana Mainnet blockchain. |
| `sentry evidence` | Calculates latency statistics and compiles a judge-ready markdown verification report. |

### Interactive REPL Console
Executing `sentry` without any arguments drops the operator into a persistent shell. This prevents the command loop from closing after execution, keeping services running and allowing subsequent command invocations:

```bash
$ sentry
  S E N T R Y
  Advanced Infrastructure Challenge | Superteam Nigeria

Interactive Operator Console — type 'help' for commands, 'exit' to quit

sentry> status
- Live Network Slot: 427137627
- Wallet Balance: 0.001863 SOL
sentry> exit
```

## 7. API References
Sentry exposes local API endpoints inside the Next.js router. These allow external interfaces to fetch real-time infrastructure data:

### GET `/api/observatory`
Returns the system's operational health, wallet balance, recent runs, Jito floor percentiles, and the last decision computed by the AI agent.

### GET `/api/slots/stream`
Exposes a Server-Sent Events (SSE) connection that streams network slots and timestamps as they arrive from the Yellowstone gRPC client.

### POST `/api/submit-bundle/stream`
Triggers the execution of a bundle on the Rust engine. It streams progress events (Preflight, Dynamic Tip Calculation, Signing, Jito Submission, Confirmation Polling) directly to the console terminal in the dashboard.
