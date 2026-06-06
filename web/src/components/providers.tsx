"use client";

import { createContext, useContext, useMemo, useCallback, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
  useDisconnectWallet,
  useSuiClient,
  ConnectModal,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import { getFullnodeUrl, type SuiEvent, type SuiObjectChange } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";
import "@mysten/dapp-kit/dist/index.css";

/** Networks that the dApp Kit will know about. Defaults to testnet; flip via env. */
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
  | "mainnet"
  | "testnet"
  | "devnet";

/**
 * Client-side network config.
 *
 * Browser SuiClient calls cannot go through `*.gateway.tatum.io` directly
 * because the Tatum gateway's CORS preflight does not allow the
 * `client-sdk-version` header that `@mysten/sui` injects automatically.
 *
 * Workaround: use the public Sui fullnode in the browser. ALL server-side
 * RPC (every API route, `/api/rpc-status`, `/api/mcp/jsonrpc`,
 * `/api/playground/rpc`, the receiver, the wallet flush, the activity
 * batch, etc.) still goes through Tatum via `web/src/lib/sui.ts` — the
 * Tatum integration is on the server side where CORS does not apply.
 *
 * If `NEXT_PUBLIC_SUI_RPC_URL` is explicitly set, it wins (advanced users
 * who run a CORS-proxy in front of Tatum can opt in).
 */
const { networkConfig } = createNetworkConfig({
  mainnet: {
    url: process.env.NEXT_PUBLIC_SUI_RPC_URL ?? getFullnodeUrl("mainnet"),
  },
  testnet: {
    url: process.env.NEXT_PUBLIC_SUI_RPC_URL ?? getFullnodeUrl("testnet"),
  },
  devnet: {
    url: process.env.NEXT_PUBLIC_SUI_RPC_URL ?? getFullnodeUrl("devnet"),
  },
});

export interface SignAndExecuteResult {
  digest: string;
  events: SuiEvent[];
  objectChanges: SuiObjectChange[];
}

interface WalletContextValue {
  address: string | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  signAndExecute: (tx: Transaction) => Promise<SignAndExecuteResult>;
  signMessage: (message: string) => Promise<{ signature: string; bytes: string }>;
  showWalletModal: boolean;
  setShowWalletModal: (v: boolean) => void;
}

const WalletContext = createContext<WalletContextValue>({
  address: null,
  isConnected: false,
  connect: () => {},
  disconnect: () => {},
  signAndExecute: async () => ({ digest: "", events: [], objectChanges: [] }),
  signMessage: async () => ({ signature: "", bytes: "" }),
  showWalletModal: false,
  setShowWalletModal: () => {},
});

export function useSuiWallet(): WalletContextValue {
  return useContext(WalletContext);
}

function WalletBridge({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTx } = useSignAndExecuteTransaction();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const suiClient = useSuiClient();
  const [showWalletModal, setShowWalletModal] = useState(false);

  const address = account?.address ?? null;

  const connect = useCallback(() => setShowWalletModal(true), []);
  const disconnect = useCallback(() => disconnectWallet(), [disconnectWallet]);

  const signAndExecute = useCallback(
    async (tx: Transaction): Promise<SignAndExecuteResult> => {
      // dApp Kit's `useSignAndExecuteTransaction` signs + submits via the
      // wallet but does NOT return events/object changes (the wallet RPC
      // shape varies). To give the launchpad + commerce flows a stable
      // structure we re-fetch the finalised transaction from our Sui
      // client (which routes through the Tatum gateway) so callers can
      // reliably parse `TalosCreated` events and the new shared Talos id.
      const result = await signAndExecuteTx({ transaction: tx });
      const digest = result.digest;

      try {
        await suiClient.waitForTransaction({ digest, timeout: 30_000 });
        const full = await suiClient.getTransactionBlock({
          digest,
          options: { showEvents: true, showObjectChanges: true, showEffects: true },
        });
        return {
          digest,
          events: full.events ?? [],
          objectChanges: full.objectChanges ?? [],
        };
      } catch {
        // Best-effort enrichment — fall back to the raw digest if the
        // gateway hasn't indexed the tx yet.
        return { digest, events: [], objectChanges: [] };
      }
    },
    [signAndExecuteTx, suiClient],
  );

  const signMessage = useCallback(
    async (message: string) => {
      const bytes = new TextEncoder().encode(message);
      const result = await signPersonalMessage({ message: bytes });
      return { signature: result.signature, bytes: result.bytes };
    },
    [signPersonalMessage],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      isConnected: !!address,
      connect,
      disconnect,
      signAndExecute,
      signMessage,
      showWalletModal,
      setShowWalletModal,
    }),
    [address, connect, disconnect, signAndExecute, signMessage, showWalletModal],
  );

  return (
    <WalletContext.Provider value={value}>
      <ConnectModal
        // dApp Kit's controlled-mode props need a non-empty trigger node.
        trigger={<span aria-hidden style={{ display: "none" }} />}
        open={showWalletModal}
        onOpenChange={setShowWalletModal}
      />
      {children}
    </WalletContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={NETWORK}>
        <WalletProvider autoConnect>
          <WalletBridge>{children}</WalletBridge>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
