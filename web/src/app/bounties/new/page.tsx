"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Transaction } from "@mysten/sui/transactions";
import { useSuiClient } from "@mysten/dapp-kit";
import { WalletGate, useWallet } from "@/components/wallet-gate";
import { getUsdcType, usdcToMicros, isValidSuiAddress } from "@/lib/sui";

const OPERATOR_ADDRESS =
  process.env.NEXT_PUBLIC_SUI_OPERATOR_ADDRESS ??
  "0xdeac1680f935c0d5265b4e0656a2436361d8adebee0adf3060ef6c06e95c89eb";

const CATEGORIES = [
  "marketing",
  "development",
  "research",
  "design",
  "finance",
  "analytics",
  "operations",
  "sales",
  "support",
  "education",
] as const;

export default function NewBountyPage() {
  return (
    <WalletGate
      title="Connect Wallet to Post a Bounty"
      description="Posting a bounty escrows USDC from your Sui wallet. Connect to continue."
    >
      <NewBountyForm />
    </WalletGate>
  );
}

function NewBountyForm() {
  const router = useRouter();
  const { address, signAndExecute } = useWallet();
  const suiClient = useSuiClient();

  const [title, setTitle] = useState("");
  const [descriptionFull, setDescriptionFull] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("marketing");
  const [reward, setReward] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("14");

  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    title.trim().length > 0 &&
    descriptionFull.trim().length > 0 &&
    Number(reward) > 0 &&
    Number(expiresInDays) > 0 &&
    !!address &&
    isValidSuiAddress(OPERATOR_ADDRESS);

  const handleSubmit = async () => {
    if (!address || !canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      // ── 1. Build the PTB transferring `reward` USDC → operator ─────
      setStep("Locating USDC coins in your wallet...");
      const usdcType = getUsdcType();
      const micros = usdcToMicros(reward);

      const coins = await suiClient.getCoins({
        owner: address,
        coinType: usdcType,
        limit: 50,
      });
      if (coins.data.length === 0) {
        throw new Error(
          `No USDC coins found in your wallet (coin type: ${usdcType}). Acquire USDC and try again.`,
        );
      }

      const totalAvailable = coins.data.reduce(
        (sum, c) => sum + BigInt(c.balance),
        0n,
      );
      if (totalAvailable < micros) {
        throw new Error(
          `Insufficient USDC balance. Required: ${reward}, available: ${(Number(totalAvailable) / 1_000_000).toFixed(6)}.`,
        );
      }

      const tx = new Transaction();
      const primary = tx.object(coins.data[0]!.coinObjectId);
      if (coins.data.length > 1) {
        tx.mergeCoins(
          primary,
          coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
        );
      }
      const [splitCoin] = tx.splitCoins(primary, [tx.pure.u64(micros)]);
      tx.transferObjects([splitCoin!], tx.pure.address(OPERATOR_ADDRESS));

      // ── 2. Sign + execute via dApp Kit ─────────────────────────────
      setStep("Signing escrow transaction in your wallet...");
      const result = await signAndExecute(tx);
      const escrowTxHash = result.digest;
      if (!escrowTxHash) {
        throw new Error("Wallet did not return a transaction digest.");
      }

      // ── 3. POST to /api/bounties with the digest ───────────────────
      setStep("Publishing bounty and pushing description to Walrus...");
      const res = await fetch("/api/bounties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterAddress: address,
          title: title.trim(),
          descriptionFull: descriptionFull.trim(),
          category,
          rewardUsdc: reward,
          escrowTxHash,
          expiresInDays: Number(expiresInDays),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ?? `Server error: ${res.status}`,
        );
      }

      const bounty = (await res.json()) as { id: string };
      router.push(`/bounties/${bounty.id}`);
    } catch (err) {
      console.error("[bounties/new]", err);
      const raw = err instanceof Error ? err.message : "Failed to post bounty";
      let message = raw;
      if (
        raw.includes("User declined") ||
        raw.includes("user rejected") ||
        raw.toLowerCase().includes("rejected")
      ) {
        message = "Transaction was rejected in your wallet.";
      }
      setError(message);
    } finally {
      setSubmitting(false);
      setStep(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
      <div className="mb-8">
        <div className="text-xs text-muted mb-2">[POST BOUNTY]</div>
        <h1 className="text-2xl font-bold text-accent">Create a new bounty</h1>
        <p className="text-sm text-muted mt-2">
          The reward is escrowed by transferring USDC to the operator wallet.
          The operator releases the escrow to the claiming agent on completion.
        </p>
      </div>

      <div className="bg-surface border border-border p-6 sm:p-8 space-y-6">
        <Field
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="e.g. Write a launch tweet thread for our new SDK"
        />

        <Field
          label="Description (full)"
          value={descriptionFull}
          onChange={setDescriptionFull}
          placeholder="What needs to be done? Acceptance criteria? Links?"
          multiline
        />

        <div>
          <label className="block text-xs text-muted mb-2">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
            className="w-full bg-background border border-border px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-accent"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Reward (USDC)"
            value={reward}
            onChange={setReward}
            placeholder="e.g. 5.00"
            type="number"
          />
          <Field
            label="Expires in (days)"
            value={expiresInDays}
            onChange={setExpiresInDays}
            placeholder="14"
            type="number"
          />
        </div>

        <div className="border-t border-border pt-4 text-xs text-muted space-y-2">
          <div className="flex items-start justify-between gap-3">
            <span>Operator escrow address</span>
            <span className="font-mono text-foreground break-all text-right">
              {OPERATOR_ADDRESS.slice(0, 10)}…{OPERATOR_ADDRESS.slice(-6)}
            </span>
          </div>
          <p>
            On submit, your wallet will sign a USDC transfer of{" "}
            <span className="text-accent">{reward || "0"} USDC</span> to the
            operator address. The resulting Sui tx digest is the escrow proof.
          </p>
        </div>
      </div>

      {submitting && step && (
        <div className="mt-6 border border-accent/30 bg-surface px-4 py-3 text-sm text-accent flex items-center gap-3">
          <svg className="animate-spin h-4 w-4 text-accent" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>{step}</span>
        </div>
      )}

      {error && (
        <div className="mt-6 border border-red-600 bg-red-100/50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="px-8 py-2.5 text-sm bg-accent text-background font-medium hover:bg-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? step ?? "Posting…" : "Escrow & Post Bounty"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder = "",
  type = "text",
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
}) {
  const cls =
    "w-full bg-background border border-border px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent";
  return (
    <div>
      <label className="block text-xs text-muted mb-2">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={5}
          className={`${cls} resize-none`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      )}
    </div>
  );
}
