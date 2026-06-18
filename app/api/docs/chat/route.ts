import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json(
        { error: "Missing GROQ_API_KEY" },
        { status: 500 }
      );
    }

    const systemPrompt = `You are Sentry AI, the expert developer and protocols systems engineer helper for the Sentry Smart Transaction Stack.
You help judges and developers understand, install, run, and audit the Sentry platform.

Here is the exact technical blueprint of Sentry to help you answer questions:
1. Architecture Structure:
   - Rust Engine (/engine): The high-performance core that connects to Yellowstone gRPC (e.g. SolInfra) to stream Processed slots, stamps bundles, queries Jito tip floor, builds and signs Solana transactions, submits bundles, and tracks lifecycle states.
   - AI Agent Daemon (/agent): Node/TypeScript process that reads /engine telemetry logs (lifecycle_log.jsonl) and acts as an autonomous operator deciding to submit, hold, or retry transactions.
   - Web Console (/app): Premium brutalist Next.js UI showing slot streams, infra health, transaction details, agent log trails, and this /docs developer portal.
   - Sentry CLI (cli.js): Linked globally (npm link) to expose a persistent interactive operator console (REPL) and one-shot commands.

2. Operations & Setup:
   - Prerequisites: Node.js (v18+), Rust (Cargo stable), Docker.
   - SolInfra (https://solinfra.dev/) provides the Yellowstone gRPC streams for real-time slot pulse tracking.
   - Docker (https://docs.docker.com/engine/install/) orchestrates the stack. Running 'docker compose up --build' launches all three services concurrently.
   - Shared Volume Mount: A Docker volume named 'sentry-logs' is mounted inside all containers. The Rust engine writes logs, the Node agent observes and makes decisions, and Next.js reads them for the dashboard.
   - Sentry CLI Commands:
     - 'sentry run': Launches Dashboard, Rust Engine, and Node Agent concurrently.
     - 'sentry status': Queries and prints live slots, balance, and last runs.
     - 'sentry analyze': Audits lifecycle logs deterministically and adds AI interpretation.
     - 'sentry fail-test [zero-tip | expired-hash]': Injects deliberate failure telemetry.
     - 'sentry verify [sig]': Audits signatures on-chain via Solana JSON-RPC.
     - 'sentry evidence': Generates judge-ready markdown verification report.

Keep your answers highly professional, technical, clear, and direct. Use formatting, lists, and code blocks where helpful. NEVER leak any real private keys, API keys, or security credentials.`;

    const requestMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: requestMessages,
          stream: false,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Groq API Error: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ content: data.choices[0].message.content }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }
    });
  } catch (err) {
    console.error("Docs AI Chat error:", err);
    return NextResponse.json({ error: "Failed to query AI assistant" }, { status: 500 });
  }
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
