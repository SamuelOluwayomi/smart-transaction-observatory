"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowSquareOut,
  Brain,
  ClockCounterClockwise,
  Copy,
  Cpu,
  Gauge,
  GitBranch,
  Lightning,
  LockKey,
  Play,
  PlugsConnected,
  RadioTower,
  ShieldCheck,
  Wallet,
} from "./components/phosphor-icons";
import { useWalletConnection } from "@solana/react-hooks";

// Helper to parse inline markdown elements safely
const parseInline = (text: string) => {
  if (!text) return "";
  // Escape HTML entities to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  html = html.replace(
    /\*\*(.*?)\*\*/g,
    '<strong class="font-black text-foreground">$1</strong>'
  );
  html = html.replace(
    /__(.*?)__/g,
    '<strong class="font-black text-foreground">$1</strong>'
  );

  // Italic: *text* or _text_
  html = html.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
  html = html.replace(/_(.*?)_/g, '<em class="italic">$1</em>');

  // Inline code: `code` (make sure it breaks anywhere for long hashes/signatures)
  html = html.replace(
    /`(.*?)`/g,
    '<code class="bg-black/5 px-1.5 py-0.5 rounded font-mono text-[10px] text-red-600 font-bold break-all inline-block max-w-full">$1</code>'
  );

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};

// Simple markdown parser to avoid npm install cross-OS issues
const renderMarkdown = (text: string) => {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  let currentBlock: {
    type: "paragraph" | "code" | "ul" | "ol";
    lines: string[];
    lang?: string;
  } | null = null;

  const flushBlock = (key: number) => {
    if (!currentBlock) return;

    if (currentBlock.type === "code") {
      const codeContent = currentBlock.lines.join("\n");
      elements.push(
        <pre
          key={key}
          className="mb-4 max-w-full overflow-x-auto border-2 border-foreground bg-black/5 p-3 font-mono text-[10px] shadow-brutal-xs"
        >
          <code className="block break-all whitespace-pre-wrap">
            {codeContent}
          </code>
        </pre>
      );
    } else if (currentBlock.type === "ul") {
      elements.push(
        <ul key={key} className="mb-4 list-disc pl-5 space-y-1">
          {currentBlock.lines.map((item, idx) => (
            <li key={idx} className="break-words">
              {parseInline(item)}
            </li>
          ))}
        </ul>
      );
    } else if (currentBlock.type === "ol") {
      elements.push(
        <ol key={key} className="mb-4 list-decimal pl-5 space-y-1">
          {currentBlock.lines.map((item, idx) => (
            <li key={idx} className="break-words">
              {parseInline(item)}
            </li>
          ))}
        </ol>
      );
    } else if (currentBlock.type === "paragraph") {
      const pContent = currentBlock.lines.join(" ");
      if (pContent.trim()) {
        elements.push(
          <p
            key={key}
            className="mb-3 leading-relaxed break-words text-foreground last:mb-0"
          >
            {parseInline(pContent)}
          </p>
        );
      }
    }

    currentBlock = null;
  };

  let keyCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Code Block boundary
    if (trimmed.startsWith("```")) {
      if (currentBlock && currentBlock.type === "code") {
        // End of code block
        flushBlock(keyCounter++);
      } else {
        // Start of code block
        flushBlock(keyCounter++);
        const lang = trimmed.slice(3).trim();
        currentBlock = { type: "code", lines: [], lang };
      }
      continue;
    }

    // If we are inside a code block, just collect the line
    if (currentBlock && currentBlock.type === "code") {
      currentBlock.lines.push(line);
      continue;
    }

    // 2. Headers
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushBlock(keyCounter++);
      const level = headerMatch[1].length;
      const titleText = headerMatch[2];

      // Select class based on level (brutalist theme, clear sizing, no uppercase unless level matches style, but keep it clean)
      let headerClass =
        "font-mono font-black text-foreground mt-4 mb-2 break-words ";
      if (level === 1)
        headerClass += "text-sm uppercase border-b border-foreground pb-1";
      else if (level === 2) headerClass += "text-xs uppercase";
      else headerClass += "text-[11px] opacity-90";

      elements.push(
        <div key={keyCounter++} className={headerClass}>
          {parseInline(titleText)}
        </div>
      );
      continue;
    }

    // 3. Lists (Unordered)
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (ulMatch) {
      const content = ulMatch[2];
      if (currentBlock && currentBlock.type !== "ul") {
        flushBlock(keyCounter++);
      }
      if (!currentBlock) {
        currentBlock = { type: "ul", lines: [] };
      }
      currentBlock.lines.push(content);
      continue;
    }

    // 4. Lists (Ordered)
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      const content = olMatch[2];
      if (currentBlock && currentBlock.type !== "ol") {
        flushBlock(keyCounter++);
      }
      if (!currentBlock) {
        currentBlock = { type: "ol", lines: [] };
      }
      currentBlock.lines.push(content);
      continue;
    }

    // 5. Empty line forces block flush
    if (trimmed === "") {
      flushBlock(keyCounter++);
      continue;
    }

    // 6. Regular text line
    if (!currentBlock) {
      currentBlock = { type: "paragraph", lines: [] };
    } else if (currentBlock.type !== "paragraph") {
      flushBlock(keyCounter++);
      currentBlock = { type: "paragraph", lines: [] };
    }
    currentBlock.lines.push(trimmed);
  }

  // Flush any remaining block at the end
  flushBlock(keyCounter++);

  return <div className="space-y-1">{elements}</div>;
};

type BundleRun = {
  bundle_id: string;
  signature: string;
  tip_lamports: number;
  tip_account: string;
  status: "Submitted" | "Pending" | "Landed" | "Failed" | "Invalid";
  submitted_at: string;
  landed_at: string | null;
  error_reason: string | null;
  run_number: number;
  profile?: RunProfile;
  failure_type?: string | null;
  failure_stage?: string | null;
  recovery?: string | null;
  ai_decision_id?: string | null;
  submit_slot?: number | null;
  landed_slot?: number | null;
  processed_at?: string | null;
  confirmed_at?: string | null;
  finalized_at?: string | null;
  confirmation_source?: string | null;
};

type RunProfile =
  | "normal"
  | "low-tip-failure"
  | "zero-tip-failure"
  | "ai-retry-test"
  | "congestion-stress";

type ObservatorySnapshot = {
  slot: number | null;
  wallet: string | null;
  balanceLamports: number | null;
  balanceSol: number | null;
  tipLamports: number | null;
  tipSourceLamports: number | null;
  tipPercentiles: {
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  } | null;
  jitoTipAccounts: number;
  runs: BundleRun[];
  agentDecision: {
    id: string;
    created_at: string;
    model: string;
    fallback: boolean;
    action: "submit" | "hold" | "retry";
    recommended_tip_lamports: number;
    confidence: number;
    reason: string;
    observed_risk: string;
  } | null;
  health: Array<{
    label: string;
    ok: boolean;
    detail: string;
  }>;
  summary: {
    total: number;
    landed: number;
    failed: number;
    invalid: number;
    pending: number;
    landedRate: number;
    medianLandingMs: number | null;
    medianProcessedToConfirmedMs: number | null;
    medianConfirmedToFinalizedMs: number | null;
  };
  errors: string[];
};

type TerminalLine = {
  level: "info" | "warn" | "error" | "success";
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
};

type SlotLine = {
  level: "info" | "slot" | "error";
  message: string;
  timestamp: string;
  slot?: number;
};

const runProfiles: Array<{
  id: RunProfile;
  label: string;
  detail: string;
}> = [
  {
    id: "normal",
    label: "Normal Dynamic Tip",
    detail: "AI chooses from live Jito floor and submits.",
  },
  {
    id: "low-tip-failure",
    label: "Low Tip Failure",
    detail: "Injects a runtime fault for failure evidence.",
  },
  {
    id: "zero-tip-failure",
    label: "Zero Tip Failure",
    detail: "Injects a second classified failure path.",
  },
  {
    id: "ai-retry-test",
    label: "AI Retry Test",
    detail: "Starts with a fault, then retries with AI tip.",
  },
  {
    id: "congestion-stress",
    label: "Congestion Stress",
    detail: "Raises the selected tip during busy conditions.",
  },
];

const architectureStages = [
  { id: "preflight", label: "RPC/Jito Preflight" },
  { id: "ai", label: "Groq Decision" },
  { id: "build", label: "Build Transaction" },
  { id: "jito-submit", label: "Jito Submit" },
  { id: "confirm", label: "Lifecycle Polling" },
  { id: "retry", label: "AI Retry" },
];

const stack = [
  {
    icon: RadioTower,
    title: "Yellowstone stream",
    body: "Live slot and leader feed from SolInfra gRPC.",
  },
  {
    icon: Lightning,
    title: "Jito sender",
    body: "Memo transaction, fresh blockhash, dynamic p75 tip, bundle id capture.",
  },
  {
    icon: ClockCounterClockwise,
    title: "Lifecycle tracker",
    body: "Polls Solana RPC and Jito inflight status until landed, failed, or timed out.",
  },
  {
    icon: Brain,
    title: "AI operator",
    body: "Makes the tip or retry call visible before submission.",
  },
];

const formatNumber = (value: number | null | undefined) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US").format(value)
    : "--";

const formatSol = (value: number | null | undefined) =>
  typeof value === "number" ? `${value.toFixed(6)} SOL` : "--";

const formatDuration = (value: number | null | undefined) =>
  typeof value === "number" ? `${(value / 1000).toFixed(1)}s` : "--";

const shortId = (value: string) =>
  value ? `${value.slice(0, 6)}...${value.slice(-6)}` : "--";

const landingDuration = (run: BundleRun) =>
  run.landed_at
    ? new Date(run.landed_at).getTime() - new Date(run.submitted_at).getTime()
    : null;

const formatIsoTime = (timestamp: string) => timestamp.slice(11, 19);

export default function Home() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const [snapshot, setSnapshot] = useState<ObservatorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<RunProfile>("normal");
  const [enableAiRetry, setEnableAiRetry] = useState(true);
  const [activeStage, setActiveStage] = useState("preflight");
  const [selectedRunNumber, setSelectedRunNumber] = useState<number | null>(
    null
  );
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [slotLines, setSlotLines] = useState<SlotLine[]>([]);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // --- AI Chat State ---
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    { role: string; content: string }[]
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  const address = wallet?.account.address.toString();
  const walletShort = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : "No wallet";
  const connected = status === "connected";
  const latestRun = snapshot?.runs[0];
  const selectedRun =
    snapshot?.runs.find((run) => run.run_number === selectedRunNumber) ??
    latestRun ??
    null;

  const refresh = useCallback(async () => {
    const response = await fetch("/api/observatory", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load observatory snapshot");
    }
    const data = (await response.json()) as ObservatorySnapshot;
    setSnapshot(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch((error) => {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to load data"
      );
      setLoading(false);
    });
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const analyzeRun = async (runContext: BundleRun, userMessage?: string) => {
    setChatLoading(true);
    if (!chatModalOpen) setChatModalOpen(true);

    const currentMessages = [...chatMessages];

    if (userMessage) {
      currentMessages.push({ role: "user", content: userMessage });
      setChatMessages([...currentMessages]);
      setChatInput("");
    } else if (currentMessages.length === 0) {
      currentMessages.push({
        role: "user",
        content:
          "Explain this transaction run to me. What happened, did it succeed or fail, and why?",
      });
    }

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: currentMessages, runContext }),
      });

      if (!res.ok) throw new Error("Failed to connect to AI");
      const data = await res.json();

      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content },
      ]);
    } catch (err) {
      console.error("AI analysis fetch failed:", err);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error: Could not analyze the transaction.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    const events = new EventSource("/api/slots/stream");

    events.onmessage = (event) => {
      const line = JSON.parse(event.data) as SlotLine;
      setSlotLines((current) => [...current.slice(-34), line]);
    };

    events.onerror = () => {
      setSlotLines((current) => [
        ...current.slice(-34),
        {
          level: "error",
          message: "Slot stream disconnected",
          timestamp: new Date().toISOString(),
        },
      ]);
      events.close();
    };

    return () => events.close();
  }, []);

  const submitBundle = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setTerminalLines([
      {
        level: "info",
        message: "$ dashboard submit-bundle --stream",
        timestamp: new Date().toISOString(),
      },
    ]);
    window.setTimeout(() => {
      terminalRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
    try {
      const response = await fetch("/api/submit-bundle/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: selectedProfile,
          enableAiRetry,
        }),
      });
      if (!response.ok) {
        throw new Error("Bundle submission stream failed");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response stream returned");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) {
            continue;
          }
          const event = JSON.parse(line.slice(6)) as TerminalLine;
          if (event.message === "[stream:end]") {
            continue;
          }
          const stage = event.data?.stage;
          if (typeof stage === "string") {
            setActiveStage(stage);
          }
          setTerminalLines((current) => [...current.slice(-80), event]);
        }
      }
      await refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Bundle submission failed";
      setSubmitError(message);
      setTerminalLines((current) => [
        ...current,
        {
          level: "error",
          message,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSubmitting(false);
    }
  };

  const metrics = useMemo(
    () => [
      {
        label: "Bundle runs",
        value: `${snapshot?.summary.total ?? 0}/12`,
        hint: "from lifecycle log",
      },
      {
        label: "Landed",
        value: `${snapshot?.summary.landedRate ?? 0}%`,
        hint: `${snapshot?.summary.landed ?? 0} confirmed`,
      },
      {
        label: "Live tip",
        value: formatNumber(snapshot?.tipLamports),
        hint: "lamports",
      },
      {
        label: "Median land",
        value: formatDuration(snapshot?.summary.medianLandingMs),
        hint: "RPC confirmed",
      },
      {
        label: "Proc->Conf",
        value: formatDuration(snapshot?.summary.medianProcessedToConfirmedMs),
        hint: "median delta",
      },
      {
        label: "Conf->Final",
        value: formatDuration(snapshot?.summary.medianConfirmedToFinalizedMs),
        hint: "median delta",
      },
    ],
    [snapshot]
  );

  const lifecycle = useMemo(() => {
    if (!latestRun) {
      return [
        {
          label: "Waiting",
          detail: "No lifecycle log entries found",
          time: "--",
          state: "queued",
        },
      ];
    }

    const stages: Array<{
      label: string;
      detail: string;
      time: string;
      state: string;
    }> = [
      {
        label: "Submitted",
        detail: latestRun.signature
          ? `Signature ${shortId(latestRun.signature)}`
          : "No signature recorded",
        time: new Date(latestRun.submitted_at).toLocaleTimeString(),
        state: "complete",
      },
    ];

    if (latestRun.processed_at) {
      stages.push({
        label: "Processed",
        detail: `Slot ${latestRun.landed_slot ?? "--"}`,
        time: new Date(latestRun.processed_at).toLocaleTimeString(),
        state: "complete",
      });
    }

    if (latestRun.confirmed_at) {
      const delta = latestRun.processed_at
        ? new Date(latestRun.confirmed_at).getTime() -
          new Date(latestRun.processed_at).getTime()
        : null;
      stages.push({
        label: "Confirmed",
        detail:
          delta !== null
            ? `+${delta}ms from processed`
            : `Slot ${latestRun.landed_slot ?? "--"}`,
        time: new Date(latestRun.confirmed_at).toLocaleTimeString(),
        state: "active",
      });
    }

    if (latestRun.finalized_at) {
      const delta = latestRun.confirmed_at
        ? new Date(latestRun.finalized_at).getTime() -
          new Date(latestRun.confirmed_at).getTime()
        : null;
      stages.push({
        label: "Finalized",
        detail: delta !== null ? `+${delta}ms from confirmed` : "Finalized",
        time: new Date(latestRun.finalized_at).toLocaleTimeString(),
        state: "complete",
      });
    }

    // If not yet processed, show the current terminal state
    if (!latestRun.processed_at) {
      stages.push({
        label: latestRun.status,
        detail:
          latestRun.error_reason ?? `Bundle ${shortId(latestRun.bundle_id)}`,
        time: latestRun.landed_at
          ? formatDuration(landingDuration(latestRun))
          : latestRun.status === "Failed" || latestRun.status === "Invalid"
            ? "--"
            : "pending",
        state:
          latestRun.status === "Landed"
            ? "active"
            : latestRun.status === "Failed" || latestRun.status === "Invalid"
              ? "failed"
              : "queued",
      });
    }

    return stages;
  }, [latestRun]);

  const agentThoughts = useMemo(
    () => [
      `Model: ${snapshot?.agentDecision?.model ?? "waiting for first decision"}.`,
      `Action: ${snapshot?.agentDecision?.action ?? "not decided yet"}.`,
      `Recommended tip: ${formatNumber(snapshot?.agentDecision?.recommended_tip_lamports ?? snapshot?.tipLamports)} lamports.`,
      snapshot?.agentDecision?.reason ??
        `Live Jito p75 source is ${formatNumber(snapshot?.tipSourceLamports)} lamports.`,
    ],
    [snapshot]
  );

  // Real terminal colours: cyan=info, yellow=warn, red=error, green=success
  const terminalLevelColor = {
    info: "#5fd7ff",
    warn: "#ffd75f",
    error: "#ff5f5f",
    success: "#87ff87",
  };

  const terminalPrefix = {
    info: "INFO",
    warn: "WARN",
    error: "ERR ",
    success: "OK  ",
  };

  const tipBars = useMemo(() => {
    const percentiles = snapshot?.tipPercentiles;
    const rows = [
      {
        label: "Low (25%)",
        hint: "75% of validators accept above this",
        value: percentiles?.p25 ?? 0,
      },
      {
        label: "Median (50%)",
        hint: "The mid-point of all active validators",
        value: percentiles?.p50 ?? 0,
      },
      {
        label: "Fast (75%)",
        hint: "Lands in the top quarter of validators",
        value: percentiles?.p75 ?? 0,
      },
      {
        label: "Top (95%)",
        hint: "Near-guaranteed inclusion this slot",
        value: percentiles?.p95 ?? 0,
      },
      {
        label: "Chosen",
        hint: "Tip the AI agent picked for this run",
        value:
          snapshot?.agentDecision?.recommended_tip_lamports ??
          snapshot?.tipLamports ??
          0,
      },
    ];
    const max = Math.max(1, ...rows.map((row) => row.value));
    return rows.map((row) => ({
      ...row,
      width: Math.max(4, Math.round((row.value / max) * 100)),
    }));
  }, [snapshot]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="noise fixed inset-0 pointer-events-none" />
      <div className="scanline fixed inset-x-0 top-0 h-20 pointer-events-none" />

      <header className="sticky top-0 z-30 border-b-2 border-foreground bg-background/82 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a className="flex items-center gap-3 font-mono text-sm font-black uppercase tracking-normal">
            <span className="grid h-8 w-8 place-items-center border-2 border-foreground bg-foreground text-background shadow-brutal-sm">
              <Activity size={18} weight="bold" />
            </span>
            Sentry
          </a>
          <nav className="hidden items-center gap-8 font-mono text-[11px] font-bold uppercase md:flex">
            <a href="#lifecycle">Lifecycle</a>
            <a href="#agent">Agent</a>
            <a href="#evidence">Evidence</a>
            <a href="#stack">Stack</a>
            <a href="/docs" className="text-red-600 font-black">Docs</a>
          </nav>
          <div className="flex items-center gap-2">
            <span className="metal hidden border-2 border-foreground px-3 py-2 font-mono text-[11px] font-bold uppercase sm:inline-flex">
              Mainnet
            </span>
            <button
              onClick={() => (connected ? disconnect() : undefined)}
              className="metal inline-flex h-10 items-center gap-2 border-2 border-foreground px-3 font-mono text-[11px] font-bold uppercase transition hover:-translate-y-0.5 hover:shadow-brutal-sm"
            >
              <Wallet size={16} weight="bold" />
              {connected ? walletShort : "Wallet"}
            </button>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:py-8">
        <div className="metal min-w-0 overflow-hidden border-2 border-foreground p-5 md:p-8 lg:min-h-[520px]">
          <div className="mb-12 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 border-2 border-foreground bg-white/86 px-3 py-2 font-mono text-[11px] font-black uppercase shadow-brutal-xs backdrop-blur">
              <ShieldCheck size={15} weight="bold" />
              Bounty Build
            </span>
            <span className="inline-flex items-center gap-2 border-2 border-foreground bg-foreground px-3 py-2 font-mono text-[11px] font-black uppercase text-background shadow-brutal-xs">
              <PlugsConnected size={15} weight="bold" />
              Jito Online
            </span>
          </div>

          <p className="mb-4 max-w-2xl font-mono text-xs font-bold uppercase tracking-normal">
            Advanced Infrastructure Challenge
          </p>
          <h1 className="max-w-full break-words text-[clamp(2.35rem,7.1vw,6rem)] font-black uppercase leading-[0.88] tracking-normal">
            Smart Transaction Stack
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-7 text-muted md:text-lg">
            A live Solana operations console that streams network state, submits
            Jito transactions with dynamic tips, records lifecycle outcomes, and
            exposes the agent decision trail judges need to verify the system.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              className="inline-flex h-12 items-center gap-2 border-2 border-foreground bg-foreground px-5 font-mono text-xs font-black uppercase text-background shadow-brutal-sm transition hover:-translate-y-0.5 hover:shadow-brutal disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting || loading}
              onClick={submitBundle}
            >
              <Play size={17} weight="fill" />
              {submitting ? "Submitting" : "Submit Bundle"}
            </button>
            <a
              href="#evidence"
              className="inline-flex h-12 items-center gap-2 border-2 border-foreground bg-white px-5 font-mono text-xs font-black uppercase shadow-brutal-sm transition hover:-translate-y-0.5 hover:shadow-brutal"
            >
              <ArrowSquareOut size={17} weight="bold" />
              View Proof
            </a>
            <a
              href="/api/evidence"
              className="inline-flex h-12 items-center gap-2 border-2 border-foreground bg-white px-5 font-mono text-xs font-black uppercase shadow-brutal-sm transition hover:-translate-y-0.5 hover:shadow-brutal"
            >
              <ArrowSquareOut size={17} weight="bold" />
              Export Evidence
            </a>
          </div>
          <div
            className={`mt-4 border-2 border-foreground bg-white/82 p-3 font-mono text-[11px] font-black uppercase transition ${
              submitting ? "shadow-brutal-sm" : ""
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {submitting
                  ? "Execution stream running"
                  : "Terminal ready below"}
              </span>
              <button
                className="border-2 border-foreground bg-foreground px-3 py-2 text-background"
                onClick={() =>
                  terminalRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                View Terminal
              </button>
            </div>
            <p className="mt-2 truncate text-[10px] text-muted">
              {terminalLines.at(-1)?.message ??
                "Submit a bundle to stream the full transaction lifecycle."}
            </p>
          </div>

          <section className="mt-8 border-2 border-foreground bg-white/78 p-4 backdrop-blur">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-black uppercase text-muted">
                  Mission Setup
                </p>
                <h2 className="text-xl font-black uppercase">
                  Choose Transaction Run
                </h2>
              </div>
              <label className="inline-flex items-center gap-2 border-2 border-foreground bg-white px-3 py-2 font-mono text-[10px] font-black uppercase">
                <input
                  checked={enableAiRetry}
                  className="h-4 w-4 accent-black"
                  onChange={(event) => setEnableAiRetry(event.target.checked)}
                  type="checkbox"
                />
                AI Retry
              </label>
            </div>
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
              {runProfiles.map((profile) => (
                <button
                  className={`min-h-[100px] border-2 border-foreground p-3 text-left transition hover:-translate-y-0.5 ${
                    selectedProfile === profile.id
                      ? "bg-foreground text-background"
                      : "bg-white/82"
                  }`}
                  key={profile.id}
                  onClick={() => setSelectedProfile(profile.id)}
                >
                  <span className="block font-mono text-[11px] font-black uppercase leading-tight tracking-tight">
                    {profile.label}
                  </span>
                  <span className="mt-2.5 block text-[11px] leading-[1.4] opacity-80">
                    {profile.detail}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="mt-12 grid gap-[2px] border-2 border-foreground bg-foreground grid-cols-2 md:grid-cols-3 xl:grid-cols-6 shadow-brutal-sm">
            {metrics.map((metric) => (
              <div
                className="min-w-0 bg-[#f8f8f8] p-3 sm:p-4"
                key={metric.label}
              >
                <p
                  className="truncate font-mono text-[10px] font-black uppercase text-muted"
                  title={metric.label}
                >
                  {metric.label}
                </p>
                <p
                  className="mt-2 truncate font-mono text-xl font-black xl:text-2xl"
                  title={String(metric.value)}
                >
                  {metric.value}
                </p>
                <p
                  className="mt-1 truncate font-mono text-[10px] font-bold uppercase text-muted"
                  title={metric.hint}
                >
                  {metric.hint}
                </p>
              </div>
            ))}
          </div>
          {submitError || (snapshot?.errors && snapshot.errors.length > 0) ? (
            <div className="mt-4 border-2 border-foreground bg-white/88 p-3 font-mono text-[11px] font-bold uppercase">
              {submitError ?? snapshot?.errors.join(" | ")}
            </div>
          ) : null}
        </div>

        <aside className="grid min-w-0 gap-5">
          <section className="glass border-2 border-foreground p-5 shadow-brutal">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] font-black uppercase text-muted">
                  Live Network
                </p>
                <h2 className="mt-1 text-2xl font-black uppercase">
                  Slot Pulse
                </h2>
              </div>
              <span className="grid h-11 w-11 place-items-center border-2 border-foreground bg-white shadow-brutal-xs">
                <Gauge size={22} weight="bold" />
              </span>
            </div>
            <div className="dark-metal border-2 border-foreground p-5 text-background">
              <p className="font-mono text-[10px] font-black uppercase">
                Latest Observed Slot
              </p>
              <p className="mt-3 break-words font-mono text-[clamp(2rem,4vw,3rem)] font-black tracking-normal">
                {formatNumber(snapshot?.slot)}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 font-mono text-[11px] font-bold uppercase">
                <button
                  onClick={() => {
                    if (snapshot?.wallet) {
                      navigator.clipboard.writeText(snapshot.wallet);
                      setCopiedWallet(true);
                      setTimeout(() => setCopiedWallet(false), 2000);
                    }
                  }}
                  disabled={!snapshot?.wallet}
                  className="flex items-center justify-between border border-background/40 px-3 py-2 hover:bg-white/10 active:bg-white/20 transition-colors text-left disabled:cursor-not-allowed"
                  title="Copy wallet address"
                >
                  <span className="truncate">
                    {snapshot?.wallet
                      ? copiedWallet
                        ? "Copied!"
                        : shortId(snapshot.wallet)
                      : "wallet pending"}
                  </span>
                  {snapshot?.wallet && !copiedWallet && (
                    <Copy size={13} className="ml-1 opacity-70 flex-shrink-0" />
                  )}
                </button>
                <span className="border border-background/40 px-3 py-2 flex items-center">
                  {formatSol(snapshot?.balanceSol)}
                </span>
              </div>
            </div>
          </section>

          <section className="metal border-2 border-foreground p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] font-black uppercase text-muted">
                  Health Checks
                </p>
                <h2 className="text-xl font-black uppercase">
                  Infra Readiness
                </h2>
              </div>
              <ShieldCheck size={24} weight="bold" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(snapshot?.health ?? []).map((check) => (
                <div
                  className="border-2 border-foreground bg-white/74 p-3"
                  key={check.label}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-black uppercase">
                      {check.label}
                    </span>
                    <span
                      className={`h-3 w-3 border-2 border-foreground ${
                        check.ok ? "bg-foreground" : "bg-white"
                      }`}
                    />
                  </div>
                  <p className="mt-2 truncate text-xs text-muted">
                    {check.detail}
                  </p>
                </div>
              ))}
              {!snapshot?.health.length && (
                <div className="border-2 border-foreground bg-white/74 p-3 font-mono text-[10px] font-black uppercase text-muted">
                  Loading checks
                </div>
              )}
            </div>
          </section>

          <section id="agent" className="metal border-2 border-foreground p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center border-2 border-foreground bg-background shadow-brutal-xs">
                <Brain size={20} weight="bold" />
              </span>
              <div>
                <p className="font-mono text-[11px] font-black uppercase text-muted">
                  Agent Decision
                </p>
                <h2 className="text-xl font-black uppercase">
                  Tip Intelligence
                </h2>
              </div>
            </div>
            <ol className="space-y-2">
              {agentThoughts.map((thought, index) => (
                <li
                  className="grid grid-cols-[32px_1fr] items-start gap-3 border-2 border-foreground bg-white/72 p-3 backdrop-blur"
                  key={thought}
                >
                  <span className="grid h-7 w-7 place-items-center bg-foreground font-mono text-[11px] font-black text-background">
                    {index + 1}
                  </span>
                  <span className="text-sm leading-6">{thought}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-[10px] font-black uppercase">
              <span className="border-2 border-foreground bg-white/72 px-3 py-2">
                Confidence{" "}
                {snapshot?.agentDecision
                  ? `${Math.round(snapshot.agentDecision.confidence * 100)}%`
                  : "--"}
              </span>
              <span className="truncate border-2 border-foreground bg-white/72 px-3 py-2">
                {snapshot?.agentDecision?.fallback ? "Fallback" : "Groq live"}
              </span>
            </div>
            <p className="mt-3 border-2 border-foreground bg-white/72 p-3 text-sm leading-6 text-muted">
              {snapshot?.agentDecision?.observed_risk ??
                "Submit a bundle to generate the first AI risk assessment."}
            </p>
          </section>
        </aside>
      </section>

      {/* ── Zone 1: Terminals (full width, side by side) ──────────────────── */}
      <section
        id="lifecycle"
        className="mx-auto grid max-w-7xl gap-5 px-4 pb-6 sm:px-6 lg:grid-cols-2"
      >
        {/* Execution Terminal */}
        <div
          className="dark-metal scroll-mt-24 min-w-0 flex flex-col border-2 border-foreground p-5 text-background shadow-brutal"
          ref={terminalRef}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-background/30 pb-3">
            <div>
              <p className="font-mono text-[11px] font-black uppercase text-background/70">
                Execution Terminal
              </p>
              <h2 className="text-2xl font-black uppercase">
                Live Transaction Setup
              </h2>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] font-black uppercase">
              <span className="border border-background/40 px-2 py-1">
                {submitting ? "Running" : "Idle"}
              </span>
              <span className="border border-background/40 px-2 py-1">
                Streamed
              </span>
            </div>
          </div>
          <div className="h-[360px] overflow-y-auto border border-background/30 bg-[#0d0d0d] p-4 font-mono text-[11px] leading-6">
            {terminalLines.map((line, index) => (
              <div
                className="grid grid-cols-[82px_46px_minmax(0,1fr)] gap-2 border-b border-white/5 py-0.5 last:border-b-0"
                key={`${line.timestamp}-${index}`}
              >
                <span style={{ color: "rgba(255,255,255,0.28)" }}>
                  {formatIsoTime(line.timestamp)}
                </span>
                <span
                  className="font-black"
                  style={{ color: terminalLevelColor[line.level] }}
                >
                  {terminalPrefix[line.level]}
                </span>
                <span
                  className="min-w-0 break-words"
                  style={{
                    color:
                      line.level === "error"
                        ? "#ff8f8f"
                        : line.level === "warn"
                          ? "#ffd75f"
                          : line.level === "success"
                            ? "#87ff87"
                            : "rgba(255,255,255,0.82)",
                  }}
                >
                  {line.message}
                  {line.data ? (
                    <span
                      className="block break-words"
                      style={{ color: "rgba(255,255,255,0.36)" }}
                    >
                      {JSON.stringify(line.data)}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
            {!terminalLines.length && (
              <div className="grid grid-cols-[82px_46px_minmax(0,1fr)] gap-2 py-0.5">
                <span style={{ color: "rgba(255,255,255,0.28)" }}>
                  --:--:--
                </span>
                <span className="font-black" style={{ color: "#5fd7ff" }}>
                  INFO
                </span>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>
                  Terminal idle. Submit a bundle to stream the full transaction
                  lifecycle.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Slot Stream */}
        <div className="dark-metal min-w-0 flex flex-col border-2 border-foreground p-5 text-background shadow-brutal">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-background/30 pb-3">
            <div>
              <p className="font-mono text-[11px] font-black uppercase text-background/70">
                Slot Stream
              </p>
              <h2 className="text-2xl font-black uppercase">
                Live Solana Slots
              </h2>
            </div>
            <span className="border border-background/40 px-2 py-1 font-mono text-[10px] font-black uppercase">
              {slotLines.at(-1)?.level === "error"
                ? "Disconnected"
                : "Streaming"}
            </span>
          </div>
          <div className="h-[360px] overflow-y-auto border border-background/30 bg-[#0d0d0d] p-4 font-mono text-[11px] leading-6">
            {slotLines.map((line, index) => (
              <div
                className="grid grid-cols-[82px_62px_minmax(0,1fr)] gap-2 border-b border-white/5 py-0.5 last:border-b-0"
                key={`${line.timestamp}-${index}`}
              >
                <span style={{ color: "rgba(255,255,255,0.28)" }}>
                  {formatIsoTime(line.timestamp)}
                </span>
                <span
                  className="font-black"
                  style={{
                    color:
                      line.level === "error"
                        ? "#ff5f5f"
                        : line.level === "slot"
                          ? "#5fd7ff"
                          : "rgba(255,255,255,0.5)",
                  }}
                >
                  {line.level === "slot" ? "SLOT" : line.level.toUpperCase()}
                </span>
                <span
                  style={{ color: "rgba(255,255,255,0.72)" }}
                  className="min-w-0 break-words"
                >
                  {line.slot ? (
                    <>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        confirmed slot{" "}
                      </span>
                      <span className="font-black" style={{ color: "#ffffff" }}>
                        {formatNumber(line.slot)}
                      </span>
                    </>
                  ) : (
                    line.message
                  )}
                </span>
              </div>
            ))}
            {!slotLines.length && (
              <div className="grid grid-cols-[82px_62px_minmax(0,1fr)] gap-2 py-0.5">
                <span style={{ color: "rgba(255,255,255,0.28)" }}>
                  --:--:--
                </span>
                <span className="font-black" style={{ color: "#5fd7ff" }}>
                  INFO
                </span>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>
                  Connecting to live slot stream...
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Zone 2: Evidence + Lifecycle (two-column, items-start) ────────── */}
      <section
        id="evidence"
        className="mx-auto grid max-w-7xl gap-5 px-4 pb-6 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)] lg:items-start"
      >
        {/* Real Bundle Evidence — left, taller */}
        <div className="metal min-w-0 self-start border-2 border-foreground p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-black uppercase text-muted">
                Lifecycle Log
              </p>
              <h2 className="text-2xl font-black uppercase">
                Real Bundle Evidence
              </h2>
            </div>
            <GitBranch size={28} weight="bold" />
          </div>
          <div className="max-h-[440px] overflow-x-auto overflow-y-auto border-2 border-foreground bg-white/82 backdrop-blur">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[44px_minmax(150px,1fr)_82px_104px_88px_84px] border-b-2 border-foreground bg-foreground px-3 py-2 font-mono text-[10px] font-black uppercase text-background">
                <span>Run</span>
                <span>Bundle</span>
                <span>Tip</span>
                <span>Status</span>
                <span>Conf</span>
                <span>Proof</span>
              </div>
              {(snapshot?.runs ?? []).map((run) => (
                <div
                  className={`grid grid-cols-[44px_minmax(150px,1fr)_82px_104px_88px_84px] items-center border-b-2 border-foreground px-3 py-3 font-mono text-[11px] font-bold last:border-b-0 cursor-pointer transition-colors ${
                    selectedRun?.run_number === run.run_number
                      ? "bg-foreground text-background"
                      : "hover:bg-foreground/5"
                  }`}
                  key={`${run.run_number}-${run.signature}`}
                  onClick={() => setSelectedRunNumber(run.run_number)}
                >
                  <span>#{run.run_number}</span>
                  <span className="truncate">
                    {shortId(run.bundle_id || run.signature)}
                  </span>
                  <span className="tabular-nums">
                    {formatNumber(run.tip_lamports)}
                  </span>
                  <span
                    className={`inline-flex h-7 w-[80px] items-center justify-center border-2 px-2 text-center text-[10px] font-black uppercase ${
                      run.status === "Landed"
                        ? "border-foreground bg-[#b4ffb4] text-black"
                        : run.status === "Failed" || run.status === "Invalid"
                          ? "border-foreground bg-[#ffb4b4] text-black"
                          : "border-transparent bg-foreground/20 text-foreground"
                    }`}
                  >
                    {run.status}
                  </span>
                  <span className="truncate text-[10px] font-black uppercase">
                    {run.confirmation_source === "yellowstone_stream"
                      ? "Stream"
                      : run.confirmation_source === "rpc_polling_fallback"
                        ? "RPC"
                        : "--"}
                  </span>
                  <a
                    className={`inline-flex h-7 w-[62px] items-center justify-center border-2 font-mono text-[10px] font-black uppercase ${
                      selectedRun?.run_number === run.run_number
                        ? "border-background text-background"
                        : "border-foreground text-foreground"
                    }`}
                    href={`https://solscan.io/tx/${run.signature}`}
                    onClick={(event) => event.stopPropagation()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open
                  </a>
                </div>
              ))}
              {!snapshot?.runs.length && (
                <div className="px-3 py-6 font-mono text-[11px] font-bold uppercase text-muted">
                  No lifecycle entries yet
                </div>
              )}
            </div>
          </div>
          {selectedRun && (
            <div className="mt-4 border-2 border-foreground bg-white/78 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Run Detail
                  </p>
                  <h3 className="text-xl font-black uppercase">
                    #{selectedRun.run_number} {selectedRun.profile ?? "normal"}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="border-2 border-foreground bg-foreground px-3 py-2 font-mono text-[10px] font-black uppercase text-background">
                    {selectedRun.status}
                  </span>
                  <button
                    onClick={() => {
                      setChatMessages([]);
                      analyzeRun(selectedRun);
                    }}
                    className="flex items-center gap-2 border-2 border-foreground bg-white shadow-brutal-sm px-4 py-2 font-mono text-[10px] font-black uppercase text-foreground transition hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"
                  >
                    <Brain size={14} weight="bold" />
                    Ask AI
                  </button>
                </div>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="min-w-0 border-2 border-foreground bg-white p-3">
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Signature
                  </p>
                  <p className="break-words font-mono text-[11px]">
                    {selectedRun.signature || "--"}
                  </p>
                </div>
                <div className="min-w-0 border-2 border-foreground bg-white p-3">
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Bundle ID
                  </p>
                  <p className="break-words font-mono text-[11px]">
                    {selectedRun.bundle_id || "--"}
                  </p>
                </div>
                <div
                  className={`border-2 border-foreground p-3 ${selectedRun.landed_slot ? "bg-[#b4ffb4]" : "bg-white"}`}
                >
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Slot Window
                  </p>
                  <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div>
                      <span className="block text-[10px] text-muted">
                        Submitted at slot
                      </span>
                      <span className="font-black">
                        {selectedRun.submit_slot ?? "not recorded"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-muted">
                        Landed at slot
                      </span>
                      <span className="font-black">
                        {selectedRun.landed_slot ??
                          (selectedRun.status === "Landed"
                            ? "confirmed"
                            : "did not land")}
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  className={`border-2 border-foreground p-3 ${
                    selectedRun.confirmation_source === "yellowstone_stream"
                      ? "bg-[#b4ffb4]"
                      : selectedRun.confirmation_source ===
                          "rpc_polling_fallback"
                        ? "bg-[#ffea75]"
                        : "bg-white"
                  }`}
                >
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Confirmation Source
                  </p>
                  <p className="font-mono text-[11px] font-black uppercase">
                    {selectedRun.confirmation_source === "yellowstone_stream"
                      ? "Yellowstone Stream"
                      : selectedRun.confirmation_source ===
                          "rpc_polling_fallback"
                        ? "RPC Fallback"
                        : "Not recorded"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {selectedRun.confirmation_source === "yellowstone_stream"
                      ? "Observed through gRPC transaction-status subscription."
                      : selectedRun.confirmation_source ===
                          "rpc_polling_fallback"
                        ? "Stream missed or timed out; RPC confirmed the signature."
                        : "Run was created before confirmation source tracking."}
                  </p>
                </div>
                <div className="border-2 border-foreground bg-white p-3 md:col-span-2">
                  <p className="mb-2 font-mono text-[10px] font-black uppercase text-muted">
                    Commitment Stages
                  </p>
                  <p className="mb-1 text-[10px] text-muted">
                    Each stage is a Solana confirmation level. A transaction
                    moves from Processed (seen by a leader) to Confirmed
                    (supermajority vote) to Finalized (irreversible).
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      { stage: "Processed", ts: selectedRun.processed_at },
                      { stage: "Confirmed", ts: selectedRun.confirmed_at },
                      { stage: "Finalized", ts: selectedRun.finalized_at },
                    ].map(({ stage, ts }) => (
                      <div
                        key={stage}
                        className={`border-2 p-2 ${
                          ts
                            ? "border-foreground bg-[#b4ffb4] text-black"
                            : "border-foreground bg-white"
                        }`}
                      >
                        <p
                          className={`font-mono text-[9px] font-black uppercase ${ts ? "text-black/70" : "text-muted"}`}
                        >
                          {stage}
                        </p>
                        <p className="mt-1 font-mono text-[10px] font-black">
                          {ts ? new Date(ts).toLocaleTimeString() : "pending"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  className={`border-2 border-foreground p-3 ${selectedRun.failure_type ? "bg-[#ffb4b4]" : "bg-white"}`}
                >
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Failure
                  </p>
                  <p>{selectedRun.failure_type ?? "None"}</p>
                </div>
                <div
                  className={`border-2 border-foreground p-3 ${selectedRun.recovery ? "bg-[#ffea75]" : "bg-white"}`}
                >
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Recovery
                  </p>
                  <p>{selectedRun.recovery ?? "No recovery needed"}</p>
                </div>
                <div className="border-2 border-foreground bg-white p-3 md:col-span-2">
                  <p className="font-mono text-[10px] font-black uppercase text-muted">
                    Raw Error
                  </p>
                  <p className="break-words">
                    {selectedRun.error_reason ?? "None"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Lifecycle Lane + Lifecycle stats stacked */}
        <div className="grid gap-5">
          <div className="metal min-w-0 self-start border-2 border-foreground p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] font-black uppercase text-muted">
                  Active Bundle
                </p>
                <h2 className="text-2xl font-black uppercase">
                  Lifecycle Lane
                </h2>
              </div>
              <ClockCounterClockwise size={28} weight="bold" />
            </div>
            <div className="space-y-3">
              {lifecycle.map((item) => (
                <div
                  className="grid grid-cols-[24px_1fr_auto] items-center gap-3 border-2 border-foreground bg-white/72 p-3 backdrop-blur"
                  key={item.label}
                >
                  <span
                    className={`h-5 w-5 border-2 border-foreground ${
                      item.state === "queued"
                        ? "bg-white"
                        : item.state === "failed"
                          ? "bg-white shadow-[inset_0_0_0_4px_#111]"
                          : "bg-foreground"
                    }`}
                  />
                  <div>
                    <p className="font-mono text-sm font-black uppercase">
                      {item.label}
                    </p>
                    <p className="line-clamp-3 break-words text-sm text-muted">
                      {item.detail}
                    </p>
                  </div>
                  <span className="border-2 border-foreground bg-white px-2 py-1 font-mono text-[10px] font-black uppercase">
                    {item.time}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="metal min-w-0 self-start border-2 border-foreground p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] font-black uppercase text-muted">
                  Tip Intelligence
                </p>
                <h2 className="text-2xl font-black uppercase">Jito Floor</h2>
              </div>
              <Gauge size={28} weight="bold" />
            </div>
            <p className="mb-4 text-xs text-muted leading-5">
              Live tip percentiles from Jito. The agent picks a tier based on
              network congestion. Values are in lamports (1 SOL = 1,000,000,000
              lamports).
            </p>
            <div className="space-y-3">
              {tipBars.map((bar) => (
                <div key={bar.label}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-black uppercase">
                      {bar.label}
                    </span>
                    <span className="font-mono text-[10px] font-black tabular-nums">
                      {formatNumber(bar.value)} lam
                    </span>
                  </div>
                  <div
                    className="h-4 border-2 border-foreground bg-white"
                    title={bar.hint}
                  >
                    <div
                      className="h-full bg-foreground"
                      style={{ width: `${bar.width}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted">{bar.hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Zone 3: Architecture + Stack (three-column, items-start) ─────── */}
      <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-6 sm:px-6 lg:grid-cols-3 lg:items-start">
        {/* Live System Flow */}
        <div className="metal min-w-0 self-start border-2 border-foreground p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-black uppercase text-muted">
                Architecture Mode
              </p>
              <h2 className="text-2xl font-black uppercase">
                Live System Flow
              </h2>
            </div>
            <RadioTower size={28} weight="bold" />
          </div>
          <div className="grid gap-3">
            {architectureStages.map((stage, index) => {
              const active = activeStage === stage.id;
              return (
                <div
                  className={`grid grid-cols-[36px_1fr] items-center gap-3 border-2 border-foreground p-3 ${
                    active ? "bg-foreground text-background" : "bg-white/72"
                  }`}
                  key={stage.id}
                >
                  <span
                    className={`grid h-8 w-8 place-items-center border-2 font-mono text-[10px] font-black ${
                      active
                        ? "border-background bg-background text-foreground"
                        : "border-foreground bg-white"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="font-mono text-xs font-black uppercase">
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stack cards — middle two */}
        <div className="grid gap-5">
          {stack.slice(0, 2).map((item) => {
            const Icon = item.icon;
            return (
              <article
                className="metal border-2 border-foreground p-5 self-start"
                key={item.title}
              >
                <Icon size={26} weight="bold" />
                <h3 className="mt-5 font-mono text-lg font-black uppercase">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted">{item.body}</p>
              </article>
            );
          })}
        </div>

        {/* Stack cards — last two */}
        <div className="grid gap-5">
          {stack.slice(2).map((item) => {
            const Icon = item.icon;
            return (
              <article
                className="metal border-2 border-foreground p-5 self-start"
                key={item.title}
              >
                <Icon size={26} weight="bold" />
                <h3 className="mt-5 font-mono text-lg font-black uppercase">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted">{item.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Zone 4: Judge Actions (standalone, full-width-ish) ──────────── */}
      <section id="stack" className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">
        <div className="dark-metal border-2 border-foreground p-5 text-background shadow-brutal lg:flex lg:items-start lg:gap-8">
          <div className="lg:w-72 lg:shrink-0">
            <LockKey size={28} weight="bold" />
            <h2 className="mt-5 text-2xl font-black uppercase">
              Judge Actions
            </h2>
            <p className="mt-3 text-sm leading-6 text-background/80">
              Connect a wallet, trigger a fresh mainnet memo bundle, then
              inspect the signature, bundle id, and lifecycle classification
              from the log.
            </p>
          </div>
          <div className="mt-5 grid gap-3 lg:mt-0 lg:flex-1">
            {connectors.length ? (
              connectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => connect(connector.id)}
                  disabled={status === "connecting"}
                  className="inline-flex h-11 items-center justify-between border-2 border-background bg-background px-3 font-mono text-[11px] font-black uppercase text-foreground shadow-[4px_4px_0_#777] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{connector.name}</span>
                  <Cpu size={16} weight="bold" />
                </button>
              ))
            ) : (
              <div className="border-2 border-background/60 p-3 font-mono text-[11px] font-bold uppercase text-background/80">
                No wallet connector detected
              </div>
            )}
          </div>
        </div>
      </section>

      {/* AI Chat Modal */}
      {chatModalOpen && selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex h-full max-h-[600px] w-full max-w-2xl flex-col border-4 border-foreground bg-background shadow-brutal">
            <div className="flex items-center justify-between border-b-2 border-foreground p-4">
              <div>
                <h3 className="font-mono text-lg font-black uppercase">
                  AI Analysis
                </h3>
                <p className="font-mono text-xs text-muted">
                  Run #{selectedRun.run_number} • {selectedRun.status}
                </p>
              </div>
              <button
                onClick={() => setChatModalOpen(false)}
                className="border-2 border-foreground bg-white px-3 py-1 font-mono text-xs font-black uppercase hover:bg-red-500 hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white/50">
              {chatMessages.length === 0 && chatLoading && (
                <div className="font-mono text-xs text-muted animate-pulse">
                  Agent is analyzing transaction...
                </div>
              )}
              {chatMessages.map((msg, idx) =>
                msg.role === "user" && idx === 0 ? null : (
                  <div
                    key={idx}
                    className={`p-4 font-mono text-xs leading-relaxed border-2 border-foreground break-words overflow-x-hidden max-w-full ${msg.role === "user" ? "bg-white ml-8" : "bg-[#f4f4f4] mr-8"}`}
                  >
                    <strong className="block mb-1 uppercase text-[10px] opacity-60">
                      {msg.role === "user" ? "You" : "Agent"}
                    </strong>
                    <div className="markdown-body break-words overflow-x-hidden max-w-full">
                      {msg.role === "user" ? (
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                      ) : (
                        <div className="markdown-render-custom break-words overflow-x-hidden max-w-full">
                          {renderMarkdown(msg.content)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
              {chatLoading && chatMessages.length > 0 && (
                <div className="font-mono text-xs text-muted animate-pulse">
                  Thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t-2 border-foreground p-4 bg-white">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chatInput.trim() && !chatLoading)
                    analyzeRun(selectedRun, chatInput);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a question about this transaction..."
                  className="flex-1 border-2 border-foreground bg-[#f8f8f8] p-3 font-mono text-xs outline-none focus:bg-white focus:ring-2 focus:ring-foreground"
                  disabled={chatLoading}
                />
                <button
                  disabled={chatLoading || !chatInput.trim()}
                  type="submit"
                  className="border-2 border-foreground bg-foreground text-background px-6 font-mono text-xs font-black uppercase disabled:opacity-50 transition hover:-translate-y-0.5 active:translate-y-0"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
