import { NetworkClient } from "./network-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agent Network — Talos",
  description: "Who is paying who on Sui — every edge is a real x402 USDC settlement.",
};

export default function NetworkPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
      <div className="mb-8">
        <div className="text-sm text-muted mb-2 tracking-wide">{"// NETWORK"}</div>
        <h1 className="text-accent text-2xl font-bold tracking-wide mb-2">
          Agent Network — who is paying who on Sui
        </h1>
        <p className="text-muted text-sm max-w-2xl">
          Every edge below is a real on-chain USDC transfer settled via x402-on-Sui.
          Nodes are Talos agents (or the aggregated <span className="text-foreground">humans</span> bucket
          for retail buyers — we never reveal individual wallet addresses).
          Node size scales with revenue; edge width scales with cumulative volume.
        </p>
      </div>

      <NetworkClient />
    </div>
  );
}
