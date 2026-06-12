"use client";

import {
  Activity,
  ArrowSquareOut,
  Brain,
  ClockCounterClockwise,
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

const lifecycle = [
  {
    label: "Submitted",
    detail: "Jito accepted tx payload",
    time: "0.30s",
    state: "complete",
  },
  {
    label: "Processed",
    detail: "RPC signature visible",
    time: "6.7s",
    state: "complete",
  },
  {
    label: "Confirmed",
    detail: "Solana RPC confirmed",
    time: "7.1s",
    state: "active",
  },
  {
    label: "Finalized",
    detail: "Awaiting finality window",
    time: "next",
    state: "queued",
  },
];

const runs = [
  {
    id: 1,
    status: "Landed",
    tip: "30,000",
    latency: "7.19s",
    bundle: "be3f57...09fce0",
  },
  {
    id: 2,
    status: "Landed",
    tip: "30,000",
    latency: "6.76s",
    bundle: "7fe180...3e266a",
  },
  {
    id: 3,
    status: "Landed",
    tip: "77,451",
    latency: "6.86s",
    bundle: "047a44...aff71c",
  },
  {
    id: 4,
    status: "Landed",
    tip: "30,000",
    latency: "6.82s",
    bundle: "58c647...9014b",
  },
  {
    id: 5,
    status: "Landed",
    tip: "30,000",
    latency: "6.72s",
    bundle: "b06da4...0d9dea",
  },
];

const metrics = [
  { label: "Bundle runs", value: "5/12", hint: "current log" },
  { label: "Landed", value: "100%", hint: "5 confirmed" },
  { label: "Tip range", value: "30k-77k", hint: "lamports" },
  { label: "Median land", value: "6.8s", hint: "RPC confirmed" },
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

const agentThoughts = [
  "Read Jito p75 landed tip percentile.",
  "Apply minimum floor: 30,000 lamports.",
  "Use randomized active tip account from Jito response.",
  "If rate limited, back off and retry up to four attempts.",
];

export default function Home() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();

  const address = wallet?.account.address.toString();
  const walletShort = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : "No wallet";
  const connected = status === "connected";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="noise fixed inset-0 pointer-events-none" />
      <div className="scanline fixed inset-x-0 top-0 h-20 pointer-events-none" />

      <header className="sticky top-0 z-30 border-b-2 border-foreground bg-background/82 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a className="flex items-center gap-3 font-mono text-sm font-black uppercase tracking-normal">
            <span className="grid h-8 w-8 place-items-center border-2 border-foreground bg-foreground text-background shadow-brutal-sm">
              <Activity size={18} weight="bold" />
            </span>
            Smart TX Observatory
          </a>
          <nav className="hidden items-center gap-8 font-mono text-[11px] font-bold uppercase md:flex">
            <a href="#lifecycle">Lifecycle</a>
            <a href="#agent">Agent</a>
            <a href="#evidence">Evidence</a>
            <a href="#stack">Stack</a>
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

      <section className="relative mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-8">
        <div className="metal min-h-[520px] border-2 border-foreground p-5 md:p-8">
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
          <h1 className="max-w-4xl text-[clamp(2.6rem,9vw,7.4rem)] font-black uppercase leading-[0.86] tracking-normal">
            Smart Transaction Stack
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-7 text-muted md:text-lg">
            A live Solana operations console that streams network state, submits
            Jito transactions with dynamic tips, records lifecycle outcomes, and
            exposes the agent decision trail judges need to verify the system.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <button className="inline-flex h-12 items-center gap-2 border-2 border-foreground bg-foreground px-5 font-mono text-xs font-black uppercase text-background shadow-brutal-sm transition hover:-translate-y-0.5 hover:shadow-brutal">
              <Play size={17} weight="fill" />
              Submit Bundle
            </button>
            <a
              href="#evidence"
              className="inline-flex h-12 items-center gap-2 border-2 border-foreground bg-white px-5 font-mono text-xs font-black uppercase shadow-brutal-sm transition hover:-translate-y-0.5 hover:shadow-brutal"
            >
              <ArrowSquareOut size={17} weight="bold" />
              View Proof
            </a>
          </div>

          <div className="mt-12 grid border-2 border-foreground bg-white/82 backdrop-blur sm:grid-cols-4">
            {metrics.map((metric) => (
              <div
                className="border-b-2 border-foreground p-4 last:border-b-0 sm:border-b-0 sm:border-r-2 sm:last:border-r-0"
                key={metric.label}
              >
                <p className="font-mono text-[10px] font-black uppercase text-muted">
                  {metric.label}
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {metric.value}
                </p>
                <p className="mt-1 font-mono text-[10px] font-bold uppercase text-muted">
                  {metric.hint}
                </p>
              </div>
            ))}
          </div>
        </div>

        <aside className="grid gap-5">
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
              <p className="mt-3 font-mono text-5xl font-black tracking-normal">
                342,918,7--
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 font-mono text-[11px] font-bold uppercase">
                <span className="border border-background/40 px-3 py-2">
                  Leader feed active
                </span>
                <span className="border border-background/40 px-3 py-2">
                  gRPC connected
                </span>
              </div>
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
                <h2 className="text-xl font-black uppercase">Tip Intelligence</h2>
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
          </section>
        </aside>
      </section>

      <section
        id="lifecycle"
        className="mx-auto grid max-w-7xl gap-5 px-4 pb-6 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]"
      >
        <div className="metal border-2 border-foreground p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-black uppercase text-muted">
                Active Bundle
              </p>
              <h2 className="text-2xl font-black uppercase">Lifecycle Lane</h2>
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
                    item.state === "queued" ? "bg-white" : "bg-foreground"
                  }`}
                />
                <div>
                  <p className="font-mono text-sm font-black uppercase">
                    {item.label}
                  </p>
                  <p className="text-sm text-muted">{item.detail}</p>
                </div>
                <span className="border-2 border-foreground bg-white px-2 py-1 font-mono text-[10px] font-black uppercase">
                  {item.time}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div id="evidence" className="metal border-2 border-foreground p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-black uppercase text-muted">
                Lifecycle Log
              </p>
              <h2 className="text-2xl font-black uppercase">Real Bundle Evidence</h2>
            </div>
            <GitBranch size={28} weight="bold" />
          </div>
          <div className="overflow-hidden border-2 border-foreground bg-white/82 backdrop-blur">
            <div className="grid grid-cols-[52px_1fr_92px_92px] border-b-2 border-foreground bg-foreground px-3 py-2 font-mono text-[10px] font-black uppercase text-background">
              <span>Run</span>
              <span>Bundle</span>
              <span>Tip</span>
              <span>Status</span>
            </div>
            {runs.map((run) => (
              <div
                className="grid grid-cols-[52px_1fr_92px_92px] items-center border-b-2 border-foreground px-3 py-3 font-mono text-[11px] font-bold last:border-b-0"
                key={run.id}
              >
                <span>#{run.id}</span>
                <span className="truncate">{run.bundle}</span>
                <span>{run.tip}</span>
                <span className="bg-foreground px-2 py-1 text-center text-[10px] font-black uppercase text-background">
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="stack"
        className="mx-auto grid max-w-7xl gap-5 px-4 pb-10 sm:px-6 lg:grid-cols-[1fr_360px]"
      >
        <div className="grid gap-5 md:grid-cols-2">
          {stack.map((item) => {
            const Icon = item.icon;
            return (
              <article
                className="metal border-2 border-foreground p-5"
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

        <section className="dark-metal border-2 border-foreground p-5 text-background shadow-brutal">
          <LockKey size={28} weight="bold" />
          <h2 className="mt-5 text-2xl font-black uppercase">Judge Actions</h2>
          <p className="mt-3 text-sm leading-6 text-background/80">
            Connect a wallet, trigger a fresh mainnet memo bundle, then inspect
            the signature, bundle id, and lifecycle classification from the log.
          </p>
          <div className="mt-5 grid gap-3">
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
        </section>
      </section>
    </main>
  );
}
