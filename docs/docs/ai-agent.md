---
sidebar_position: 3
---
# Autonomous AI Agent

## 4. Autonomous AI Agent
The Sentry operator console is augmented by an asynchronous node-based AI Agent located in `/agent`. The agent is designed to inspect the execution telemetry of the Rust engine and determine operational modifications.

### The Telemetry Feed
The agent reads from a shared lifecycle log file (`lifecycle_log.jsonl`) and a decision log file (`agent_decisions.jsonl`). It aggregates data across the last 10 submission runs:
* **Landing Success Rate**: The percentage of submitted bundles that successfully land on-chain.
* **Confirmation Latency (Slot Delta)**: The difference between the submission slot and the landed slot.
* **Commitment Delta**: The time in milliseconds taken to transition from Processed status to Confirmed.
* **Failure Classifications**: Stored flags categorizing errors (e.g. invalid tips, expired blockhashes).

### Local Rules Policy vs. Groq LLM LLAMA Chain
Sentry utilizes a two-tier decision-making policy to remain operational even when remote LLM nodes are unreachable:

**1. Local Rules Policy (Default)**
Runs locally inside the Node event loop. If landing rates are healthy and processed-to-confirmed times are under 3 seconds, it outputs a default tip recommendation. If minor congestion is identified, it applies a simple multiplier to the Jito floor.

**2. LLM Reasoning Chain (Fallback/Deep Audit)**
If landing rates drop below 60% or repeated failures are detected, Sentry queries Groq using a `llama-3.3-70b-versatile` reasoning prompt. The prompt includes raw JSON runs data and requests a structured JSON response specifying the next action (`submit`, `hold`, or `retry`), recommended tip premium, and textual justification.

## 9. Sentry AI Assistant
Query the Sentry AI Docs Agent directly to get specific help with setting up the project, resolving infrastructure errors, or understanding code details:

import AIAssistant from '@site/src/components/AIAssistant';

<AIAssistant />
