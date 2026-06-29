import http from "node:http";
import { Sentry } from "./lib/sentry-sdk";

const port = process.env.PORT || 3050;
const sentry = new Sentry();

// Warm up connection on startup
sentry.start()
  .then((status) => {
    console.log(`[Sentry API] SDK initialized successfully. Wallet: ${status.wallet}`);
  })
  .catch((err) => {
    console.error(`[Sentry API] SDK initialization failed on startup:`, err);
  });

const server = http.createServer(async (req, res) => {
  // Add CORS headers for developer console integrations
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || "";

  if (url === "/health" && req.method === "GET") {
    try {
      const status = await sentry.start();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          initialized: true,
          rpcSlot: status.rpcSlot,
          wallet: status.wallet,
          balanceSol: status.balanceSol,
        })
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "unhealthy", error: String(err) }));
    }
    return;
  }

  if (url === "/submit" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        if (!payload.transaction) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing 'transaction' field (base64 or hex serialized transaction)" }));
          return;
        }

        console.log(`[Sentry API] Submitting transaction via SDK (urgency: ${payload.urgency || "medium"})`);
        const result = await sentry.submit(payload.transaction, {
          urgency: payload.urgency,
          profile: payload.profile,
        });

        res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  // Route fallback: 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found. Use GET /health or POST /submit" }));
});

server.listen(port, () => {
  console.log(`[Sentry API] Standalone developer server running on http://localhost:${port}`);
});
