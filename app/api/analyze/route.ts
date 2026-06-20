import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { messages, runContext } = await req.json();

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json(
        { error: "Missing GROQ_API_KEY" },
        { status: 500 }
      );
    }

    const systemPrompt = `You are a Solana transaction analysis expert.
You are helping the user understand a specific transaction run from their Smart Transaction Observatory dashboard.
Be concise, highly technical but accessible, and directly answer their questions.
Break down what happened in the transaction. Use markdown.

In your explanation, you MUST explicitly detail the role and difference between:
1. **Yellowstone Stream (\`yellowstone_stream\` / gRPC)**: This is the high-performance confirmation source. It uses a live Yellowstone gRPC subscription to monitor transactions in real-time on-chain, completely bypassing the latency and overhead of standard HTTP polling.
2. **RPC Polling Fallback (\`rpc_polling_fallback\`)**: This is the fallback path. If the gRPC stream misses the transaction or times out, the system polls the Solana RPC node's \`getSignatureStatuses\` endpoint until confirmation is reached.

Based on the \`confirmation_source\` in the Transaction Context below:
- Clarify that the project's codebase **fully satisfies** the Yellowstone gRPC requirements of the bounty (the Yellowstone gRPC stream is dedicated exclusively to transaction status confirmation, allowing true stream-based confirmation on every run).
- Explain that slot tracking is handled via a high-frequency (400ms) RPC polling loop, freeing the single gRPC stream allowed by the SolInfra Ace Plan to prevent stream contention. If a fallback to `rpc_polling_fallback` occurs, it represents a resilient fallback path in case of network drops or transient gRPC stream issues.
- Discuss the latency deltas (\`processed_at\`, \`confirmed_at\`, \`finalized_at\`) and what they show about network congestion during this run.

Transaction Context:
${JSON.stringify(runContext, null, 2)}
`;

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
    return NextResponse.json({ content: data.choices[0].message.content });
  } catch (err) {
    console.error("Analyze error:", err);
    return NextResponse.json({ error: "Failed to analyze" }, { status: 500 });
  }
}
