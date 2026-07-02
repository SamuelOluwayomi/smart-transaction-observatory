import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
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

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sentry Developer Gateway | Solana Mainnet</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #09090b;
      --panel: rgba(24, 24, 27, 0.6);
      --border: rgba(63, 63, 70, 0.4);
      --text: #f4f4f5;
      --text-muted: #a1a1aa;
      --primary: #8b5cf6;
      --primary-hover: #7c3aed;
      --accent: #06b6d4;
      --green: #22c55e;
      --red: #ef4444;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background-image: 
        radial-gradient(circle at 10% 20%, rgba(139, 92, 246, 0.1) 0%, transparent 40%),
        radial-gradient(circle at 90% 80%, rgba(6, 182, 212, 0.08) 0%, transparent 40%);
    }

    header {
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(12px);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-image {
      width: 2.25rem;
      height: 2.25rem;
      object-fit: contain;
      border-radius: 0.5rem;
    }

    .logo-text {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      background: linear-gradient(to right, #ffffff, var(--text-muted));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .server-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      background: rgba(36, 36, 40, 0.5);
      border: 1px solid var(--border);
      padding: 0.375rem 0.75rem;
      border-radius: 9999px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--green);
      box-shadow: 0 0 8px var(--green);
    }

    .status-dot.loading {
      background-color: #eab308;
      box-shadow: 0 0 8px #eab308;
    }

    .status-dot.unhealthy {
      background-color: var(--red);
      box-shadow: 0 0 8px var(--red);
    }

    main {
      flex: 1;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1.5fr;
      gap: 1.5rem;
    }

    @media (max-width: 868px) {
      main {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .card-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: white;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-bottom: 1px solid rgba(63, 63, 70, 0.2);
      padding-bottom: 0.75rem;
    }

    .diag-item {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .diag-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
    }

    .diag-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.95rem;
      background: rgba(9, 9, 11, 0.4);
      padding: 0.5rem 0.75rem;
      border-radius: 0.375rem;
      border: 1px solid rgba(63, 63, 70, 0.2);
      word-break: break-all;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .btn-copy {
      background: transparent;
      border: none;
      color: var(--primary);
      cursor: pointer;
      font-size: 0.8rem;
      font-family: inherit;
      padding: 0.2rem 0.4rem;
      border-radius: 0.25rem;
      transition: background 0.2s;
    }

    .btn-copy:hover {
      background: rgba(139, 92, 246, 0.1);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-muted);
    }

    textarea {
      background: rgba(9, 9, 11, 0.5);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      color: white;
      padding: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      resize: vertical;
      min-height: 120px;
      outline: none;
      transition: border-color 0.2s;
    }

    textarea:focus {
      border-color: var(--primary);
    }

    .options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    select, input[type="text"] {
      background: rgba(9, 9, 11, 0.5);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      color: white;
      padding: 0.625rem;
      outline: none;
      font-family: inherit;
      transition: border-color 0.2s;
    }

    select:focus, input[type="text"]:focus {
      border-color: var(--primary);
    }

    .btn-submit {
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      color: white;
      border: none;
      padding: 0.875rem;
      border-radius: 0.5rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.1s, opacity 0.2s;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
    }

    .btn-submit:hover {
      opacity: 0.9;
    }

    .btn-submit:active {
      transform: scale(0.98);
    }

    .btn-submit:disabled {
      background: var(--border);
      cursor: not-allowed;
      box-shadow: none;
      opacity: 0.5;
    }

    .console-card {
      grid-column: 1 / -1;
      min-height: 250px;
    }

    .console-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    .console-output {
      background: #040405;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      flex: 1;
      overflow-y: auto;
      max-height: 350px;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .log-line {
      display: flex;
      gap: 0.5rem;
    }

    .log-time {
      color: #71717a;
      flex-shrink: 0;
    }

    .log-info { color: #38bdf8; }
    .log-success { color: var(--green); }
    .log-warning { color: #f59e0b; }
    .log-error { color: var(--red); }

    .json-output {
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: rgba(36, 36, 40, 0.3);
      border-radius: 0.25rem;
      color: #e4e4e7;
      white-space: pre-wrap;
    }

    footer {
      border-top: 1px solid var(--border);
      padding: 1.25rem 2rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-muted);
      background: rgba(9, 9, 11, 0.8);
      backdrop-filter: blur(12px);
    }

    footer a {
      color: var(--primary);
      text-decoration: none;
    }

    footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-container">
      <img class="logo-image" src="/Sentry-logo.png" alt="Sentry Logo" />
      <span class="logo-text">Sentry REST Gateway</span>
    </div>
    <div class="server-status" id="server-status">
      <div class="status-dot" id="status-dot"></div>
      <span id="status-text">Connecting...</span>
    </div>
  </header>

  <main>
    <!-- Left Column: Diagnostics -->
    <div class="card">
      <h2 class="card-title">Gateway Diagnostics</h2>
      
      <div class="diag-item">
        <span class="diag-label">RPC Endpoint (SolInfra)</span>
        <span class="diag-value">mainnet.block-engine.jito.wtf</span>
      </div>

      <div class="diag-item">
        <span class="diag-label">Sentry Wallet</span>
        <span class="diag-value">
          <span id="wallet-address">Loading...</span>
          <button class="btn-copy" onclick="copyWallet()">Copy</button>
        </span>
      </div>

      <div class="diag-item">
        <span class="diag-label">Wallet Balance</span>
        <span class="diag-value" id="wallet-balance">0.000000 SOL</span>
      </div>

      <div class="diag-item">
        <span class="diag-label">Live Solana Slot</span>
        <span class="diag-value" id="live-slot">---</span>
      </div>
    </div>

    <!-- Right Column: Submission Form -->
    <div class="card">
      <h2 class="card-title">Submit Transaction Bundle</h2>
      
      <div class="form-group">
        <label for="tx-payload">Serialized Transaction (Base64)</label>
        <textarea id="tx-payload" placeholder="Paste base64 encoded signed or unsigned transaction..."></textarea>
      </div>

      <div class="options-grid">
        <div class="form-group">
          <label for="urgency-select">Tip Urgency Profile</label>
          <select id="urgency-select">
            <option value="low">Low (Jito 25th percentile)</option>
            <option value="medium" selected>Medium (Jito 75th percentile)</option>
            <option value="high">High (Jito 95th percentile)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="profile-select">Execution Profile</label>
          <select id="profile-select">
            <option value="default" selected>Default (Normal)</option>
            <option value="zero-tip-failure">Force Low Tip (Scenario 2)</option>
            <option value="expired-hash">Force Expired Hash (Scenario 3)</option>
          </select>
        </div>
      </div>

      <button class="btn-submit" id="btn-submit" onclick="submitTransaction()">Submit Private Bundle</button>
    </div>

    <!-- Bottom Row: Terminal Console -->
    <div class="card console-card">
      <div class="console-header">
        <h2 class="card-title">Execution Console</h2>
        <button class="btn-copy" onclick="clearConsole()">Clear Logs</button>
      </div>
      <div class="console-output" id="console-output"></div>
    </div>
  </main>

  <footer>
    Sentry Smart Transaction Stack &copy; 2026. Powered by <a href="https://solinfra.dev" target="_blank">SolInfra</a> &amp; <a href="https://jito.wtf" target="_blank">Jito</a>.
  </footer>

  <script>
    const consoleEl = document.getElementById("console-output");
    log("Console initialized. Ready to observe submissions.", "info");

    function log(text, type = "info") {
      const line = document.createElement("div");
      line.className = "log-line";
      
      const timeSpan = document.createElement("span");
      timeSpan.className = "log-time";
      timeSpan.textContent = \`[\` + new Date().toLocaleTimeString() + \`]\`;
      
      const contentSpan = document.createElement("span");
      contentSpan.className = \`log-\` + type;
      contentSpan.textContent = text;
      
      line.appendChild(timeSpan);
      line.appendChild(contentSpan);
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function clearConsole() {
      consoleEl.innerHTML = "";
      log("Console cleared.", "info");
    }

    async function copyWallet() {
      const addr = document.getElementById("wallet-address").textContent;
      if (addr && addr !== "Loading...") {
        await navigator.clipboard.writeText(addr);
        log("Wallet address copied to clipboard.", "success");
      }
    }

    async function fetchDiagnostics() {
      try {
        const res = await fetch("/health");
        const data = await res.json();
        
        if (data.status === "healthy") {
          document.getElementById("status-dot").className = "status-dot";
          document.getElementById("status-text").textContent = "Healthy";
          document.getElementById("wallet-address").textContent = data.wallet;
          document.getElementById("wallet-balance").textContent = data.balanceSol.toFixed(6) + " SOL";
          document.getElementById("live-slot").textContent = data.rpcSlot || "---";
        } else {
          throw new Error("Diagnostics state unhealthy");
        }
      } catch (err) {
        document.getElementById("status-dot").className = "status-dot unhealthy";
        document.getElementById("status-text").textContent = "Unhealthy / Offline";
        log("Error polling gateway diagnostics: " + err.message, "error");
      }
    }

    async function submitTransaction() {
      const payload = document.getElementById("tx-payload").value.trim();
      if (!payload) {
        log("Cannot submit: Serialized transaction payload is empty.", "error");
        return;
      }

      const urgency = document.getElementById("urgency-select").value;
      const profile = document.getElementById("profile-select").value;
      
      const submitBtn = document.getElementById("btn-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Executing...";

      log("Initiating transaction submission (urgency: " + urgency + ", profile: " + profile + ")...", "info");

      try {
        const res = await fetch("/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            transaction: payload,
            urgency: urgency,
            profile: profile === "default" ? undefined : profile
          })
        });

        const data = await res.json();
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Private Bundle";

        if (data.success) {
          log("Transaction successfully landed on-chain!", "success");
          log("  Signature: " + data.signature, "success");
          log("  Landed Slot: " + data.slot, "success");
          log("  Jito Bundle ID: " + data.bundleId, "success");
        } else {
          log("Transaction submission failed.", "error");
          log("  Reason: " + (data.error || "Unknown Error"), "error");
        }

        const pre = document.createElement("pre");
        pre.className = "json-output";
        pre.textContent = JSON.stringify(data, null, 2);
        consoleEl.appendChild(pre);
        consoleEl.scrollTop = consoleEl.scrollHeight;
        
        // Refresh diagnostics
        fetchDiagnostics();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Private Bundle";
        log("Fatal error during submission request: " + err.message, "error");
      }
    }

    // Diagnostics Polling
    fetchDiagnostics();
    setInterval(fetchDiagnostics, 3000);
  </script>
</body>
</html>`;

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

  // Render Interactive Developer Playground
  if (url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(htmlContent);
    return;
  }

  // Serve Sentry Logo
  if (url === "/Sentry-logo.png" && req.method === "GET") {
    try {
      const filePath = path.join(process.cwd(), "public", "Sentry-logo.png");
      const fileBuffer = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(fileBuffer);
    } catch (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
    return;
  }

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
