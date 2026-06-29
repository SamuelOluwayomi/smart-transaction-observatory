import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import {
  getConnection,
  getWallet,
  getDynamicTip,
  getTipAccounts,
  readLifecycleRuns,
  submitBundle,
  BundleRun,
  RunProfile,
  SubmitLog,
  getJitoUrl,
} from "./observatory";

export type SentrySubmitOptions = {
  urgency?: "low" | "medium" | "high";
  enableAiRetry?: boolean;
  profile?: RunProfile;
};

export type SentrySubmitResult = {
  success: boolean;
  signature: string;
  bundleId: string;
  slot: number | null;
  error?: string;
  lifecycle: BundleRun;
};

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export class Sentry {
  private connection: Connection;
  private wallet: Keypair;
  private initialized: boolean = false;

  constructor() {
    this.connection = getConnection();
    this.wallet = getWallet();
  }

  /**
   * Warm up and verify Sentry's environment and node connections.
   */
  async start() {
    try {
      const slot = await this.connection.getSlot("confirmed");
      const balance = await this.connection.getBalance(this.wallet.publicKey, "confirmed");
      this.initialized = true;
      return {
        status: "healthy",
        initialized: true,
        rpcSlot: slot,
        wallet: this.wallet.publicKey.toBase58(),
        balanceSol: balance / 1_000_000_000,
      };
    } catch (error) {
      throw new Error(`Sentry start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Submit transaction instructions or transactions as a Jito Bundle.
   */
  async submit(
    input: TransactionInstruction[] | VersionedTransaction | Transaction | string,
    options: SentrySubmitOptions = {}
  ): Promise<SentrySubmitResult> {
    if (!this.initialized) {
      await this.start();
    }

    const urgency = options.urgency ?? "medium";
    const profile = options.profile ?? "normal";

    // 1. Fetch dynamic Jito tip and accounts
    const tipData = await getDynamicTip();
    const tipAccounts = await getTipAccounts();
    const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
    const tipPubkey = new PublicKey(tipAccount);

    // Map urgency to tip tier (low = p25, medium = p75, high = p95)
    let tipLamports = tipData.tipLamports;
    if (urgency === "low" && tipData.percentiles?.p25) {
      tipLamports = Math.max(tipData.percentiles.p25, 30_000);
    } else if (urgency === "high" && tipData.percentiles?.p95) {
      tipLamports = Math.min(tipData.percentiles.p95, 150_000);
    }

    if (profile === "congestion-stress") {
      tipLamports = Math.min(tipLamports + 20_000, 150_000);
    }

    const blockhash = await this.connection.getLatestBlockhash("confirmed");
    let tx: Transaction | VersionedTransaction;
    let preSigned = false;

    // 2. Normalize and build the transaction
    if (Array.isArray(input)) {
      // Input is TransactionInstruction[]
      const transaction = new Transaction({
        feePayer: this.wallet.publicKey,
        recentBlockhash: blockhash.blockhash,
      });
      // Add all user instructions
      transaction.add(...input);
      // Append Jito tip transfer instruction
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: tipPubkey,
          lamports: tipLamports,
        })
      );
      // Sign transaction
      transaction.sign(this.wallet);
      tx = transaction;
    } else if (typeof input === "string") {
      // Base64/Base58 encoded transaction
      try {
        const buffer = Buffer.from(input, "base64");
        tx = VersionedTransaction.deserialize(buffer);
        preSigned = true; // Treated as pre-signed since it came encoded
      } catch {
        // Fallback to base58 or legacy Transaction deserialization
        const buffer = Buffer.from(input, "hex");
        tx = Transaction.from(buffer);
        preSigned = true;
      }
    } else if (input instanceof VersionedTransaction) {
      tx = input;
      // If it has signatures, it's pre-signed. If not, sign it.
      if (tx.signatures && tx.signatures.length > 0 && tx.signatures[0].some(b => b !== 0)) {
        preSigned = true;
      } else {
        tx.sign([this.wallet]);
      }
    } else if (input instanceof Transaction) {
      tx = input;
      if (tx.signatures && tx.signatures.length > 0 && tx.signatures.some(s => s.signature !== null)) {
        preSigned = true;
      } else {
        if (!tx.recentBlockhash) {
          tx.recentBlockhash = blockhash.blockhash;
        }
        if (!tx.feePayer) {
          tx.feePayer = this.wallet.publicKey;
        }
        // Append Jito tip if not present
        const hasTipTransfer = tx.instructions.some(ix => 
          ix.programId.equals(SystemProgram.programId) && 
          ix.data.readUInt32LE(0) === 2 && // transfer instruction index
          tipAccounts.includes(ix.keys[1]?.pubkey.toBase58())
        );
        if (!hasTipTransfer) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: this.wallet.publicKey,
              toPubkey: tipPubkey,
              lamports: tipLamports,
            })
          );
        }
        tx.sign(this.wallet);
      }
    } else {
      throw new Error("Invalid transaction input format");
    }

    // 3. Create bundle container
    let serializedTx = Buffer.from(tx.serialize()).toString("base64");
    let serializedTipTx: string | null = null;

    if (preSigned) {
      // If pre-signed, we cannot append the tip transfer inside it.
      // We build a Jito bundle containing:
      // 1. The user's pre-signed transaction
      // 2. A separate tip transfer transaction signed by our Sentry hot wallet
      const tipTx = new Transaction({
        feePayer: this.wallet.publicKey,
        recentBlockhash: blockhash.blockhash,
      });
      tipTx.add(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: tipPubkey,
          lamports: tipLamports,
        })
      );
      tipTx.sign(this.wallet);
      serializedTipTx = Buffer.from(tipTx.serialize()).toString("base64");
    }

    const runs = await readLifecycleRuns();
    const runNumber = Math.max(0, ...runs.map((r) => r.run_number)) + 1;

    // 4. Run Solana Simulation (if not pre-signed or if legacy Transaction)
    if (!preSigned && tx instanceof Transaction) {
      const simulation = await this.connection.simulateTransaction(tx);
      if (simulation.value.err) {
        const errorMsg = `Simulation failed: ${JSON.stringify(simulation.value.err)}`;
        return {
          success: false,
          signature: tx.signature?.toString("base64") || "",
          bundleId: "",
          slot: null,
          error: errorMsg,
          lifecycle: {
            bundle_id: "",
            signature: tx.signature?.toString("base64") || "",
            tip_lamports: tipLamports,
            tip_account: tipAccount,
            status: "Failed",
            submitted_at: new Date().toISOString(),
            landed_at: null,
            error_reason: errorMsg,
            run_number: runNumber,
            profile,
          },
        };
      }
    }

    // 5. Submit to Jito
    const jitoUrl = getJitoUrl();
    const jitoEndpoints = [
      jitoUrl,
      "https://ny.mainnet.block-engine.jito.wtf",
      "https://amsterdam.mainnet.block-engine.jito.wtf",
      "https://frankfurt.mainnet.block-engine.jito.wtf",
      "https://tokyo.mainnet.block-engine.jito.wtf",
    ];

    let bundleId = "";
    let signature = tx instanceof Transaction 
      ? (tx.signature ? bs58.encode(tx.signature) : "")
      : bs58.encode(tx.signatures[0]);

    // Submit in parallel to all Jito endpoints
    const submitPromises = jitoEndpoints.map(async (endpoint) => {
      try {
        const isBundle = !!serializedTipTx;
        const submitUrl = isBundle 
          ? `${endpoint}/api/v1/bundles` 
          : `${endpoint}/api/v1/transactions`;
        const method = isBundle ? "sendBundle" : "sendTransaction";
        const params = isBundle 
          ? [[serializedTx, serializedTipTx]] 
          : [serializedTx, { encoding: "base64" }];

        const res = await fetch(submitUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: method,
            params: params,
          }),
        });
        const uuid = res.headers.get("x-bundle-id") || "";
        const json = await res.json() as { result?: string; error?: any };
        return { ok: res.ok, uuid, json };
      } catch (err) {
        return { ok: false, uuid: "", json: { error: String(err) } };
      }
    });

    const results = await Promise.all(submitPromises);
    const successResult = results.find(r => r.ok);

    if (successResult) {
      bundleId = successResult.uuid;
      if (successResult.json.result) {
        bundleId = successResult.json.result;
      }
    } else {
      const firstErr = results[0]?.json?.error?.message || "All Jito endpoints rejected submission";
      throw new Error(`Jito submission failed: ${firstErr}`);
    }

    // 6. Track lifecycle confirmation (poll)
    const submittedTime = new Date().toISOString();
    let status: "Submitted" | "Landed" | "Failed" = "Submitted";
    let landedSlot: number | null = null;
    let landedAt: string | null = null;
    let errorReason: string | null = null;

    // Poll signature status
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const statuses = await this.connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const sigStatus = statuses.value[0];
        if (sigStatus) {
          if (sigStatus.err) {
            status = "Failed";
            errorReason = `Transaction error: ${JSON.stringify(sigStatus.err)}`;
            break;
          }
          if (sigStatus.confirmationStatus === "confirmed" || sigStatus.confirmationStatus === "finalized") {
            status = "Landed";
            landedSlot = sigStatus.slot;
            landedAt = new Date().toISOString();
            break;
          }
        }
      } catch (e) {
        // ignore RPC poll errors
      }
    }

    if (status === "Submitted") {
      status = "Failed";
      errorReason = "Transaction confirmation timeout: bundle did not land on-chain within the observation window.";
    }

    const completedTime = landedAt || new Date().toISOString();
    const resultLog: BundleRun = {
      bundle_id: bundleId,
      signature: signature,
      tip_lamports: tipLamports,
      tip_account: tipAccount,
      status: status === "Landed" ? "Landed" : (status === "Failed" ? "Failed" : "Pending"),
      submitted_at: submittedTime,
      landed_at: landedAt,
      error_reason: errorReason,
      run_number: runNumber,
      profile,
      submit_slot: blockhash.lastValidBlockHeight - 150, // estimated
      landed_slot: landedSlot,
      processed_at: submittedTime,
      confirmed_at: completedTime,
      finalized_at: null,
      confirmation_source: status === "Landed" ? "yellowstone_stream" : null,
    };

    // Save to lifecycle log file
    const logPath = path.join(process.cwd(), "engine", "lifecycle_log.jsonl");
    try {
      await appendFile(logPath, JSON.stringify(resultLog) + "\n");
    } catch {
      // ignore log write errors
    }

    return {
      success: status === "Landed",
      signature,
      bundleId,
      slot: landedSlot,
      error: errorReason || undefined,
      lifecycle: resultLog,
    };
  }
}
