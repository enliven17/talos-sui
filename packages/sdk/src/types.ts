// ── Request types ────────────────────────────────────────────────

export interface CreateTalosParams {
  name: string;
  category: string;
  description: string;
  totalSupply?: number;
  persona?: string;
  targetAudience?: string;
  channels?: string[];
  toneVoice?: string;
  approvalThreshold?: number;
  gtmBudget?: number;
  creatorAddress?: string;
  walletAddress?: string;
  onChainId?: number;
  onChainObjectId?: string;
  agentName?: string;
  initialPrice?: number;
  minPatronPulse?: number;
  mitosCoinType?: string;
  walrusProfileBlob?: string;
  serviceName?: string;
  serviceDescription?: string;
  servicePrice?: number;
}

export interface ReportActivityParams {
  type: string;
  content: string;
  channel: string;
  /** Optional rich payload — pushed to Walrus by the server. */
  fullPayload?: unknown;
}

export interface ReportRevenueParams {
  amount: number;
  currency?: string;
  source: string;
  txHash?: string;
}

export interface CreateApprovalParams {
  type: string;
  title: string;
  description?: string;
  amount?: number;
}

export interface RegisterServiceParams {
  serviceName: string;
  description: string;
  price: number;
  suiAddress?: string;
}

export interface SignPaymentParams {
  /** Sui address of the payee. */
  payee: string;
  amount: number | string;
  /** Coin type tag — defaults to USDC for the active network. */
  coinType?: string;
}

export interface DiscoverServicesParams {
  category?: string;
  target?: string;
}

export interface PurchaseServiceParams {
  /** `X-Payment` header value: `sui-tx <digest>`. */
  paymentHeader: string;
  payload?: Record<string, unknown>;
}

// ── Response types ───────────────────────────────────────────────

export interface Talos {
  id: string;
  onChainId?: number;
  onChainObjectId?: string;
  agentName?: string;
  name: string;
  category: string;
  description: string;
  status: string;
  mitosCoinType?: string;
  pulsePrice: string;
  totalSupply: number;
  creatorShare: number;
  investorShare: number;
  treasuryShare: number;
  persona?: string;
  targetAudience?: string;
  channels: string[];
  toneVoice?: string;
  approvalThreshold: string;
  gtmBudget: string;
  minPatronPulse?: number;
  agentOnline: boolean;
  agentLastSeen?: string;
  walletAddress?: string;
  creatorAddress?: string;
  investorAddress?: string;
  treasuryAddress?: string;
  walrusProfileBlob?: string;
  createdAt: string;
  updatedAt: string;
  patrons?: number;
}

export interface TalosDetail extends Talos {
  apiKeyMasked?: string;
  activities?: Activity[];
  approvals?: Approval[];
  revenues?: Revenue[];
  commerceServices?: CommerceService[];
}

export interface TalosCreated extends Talos {
  apiKeyOnce: string;
}

export interface Activity {
  id: string;
  talosId: string;
  type: string;
  content: string;
  channel: string;
  status: string;
  walrusBlobId?: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  talosId: string;
  type: string;
  title: string;
  description?: string;
  amount?: string;
  status: string;
  decidedAt?: string;
  decidedBy?: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Revenue {
  id: string;
  talosId: string;
  amount: string;
  currency: string;
  source: string;
  txHash?: string;
  createdAt: string;
}

export interface CommerceService {
  id: string;
  talosId: string;
  serviceName: string;
  description?: string;
  price: string;
  currency: string;
  suiAddress: string;
  chains: string[];
  fulfillmentMode: string;
}

export interface CommerceJob {
  id: string;
  talosId: string;
  requesterTalosId: string;
  serviceName: string;
  payload?: unknown;
  result?: unknown;
  walrusResultBlobId?: string;
  status: string;
  amount: string;
  createdAt: string;
}

export interface PaymentDetails {
  price: number;
  payee: string;
  coinType: string;
  network: string;
}

export interface SignedPayment {
  paymentHeader: string;
  paymentToken: string;
  txHash: string;
  from: string;
  to: string;
  amount: string;
  coinType: string;
}

export interface Wallet {
  walletId: string;
  publicKey: string;
}
