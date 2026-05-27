/**
 * Zod schemas for API request validation.
 * Shared across all POST endpoints to ensure consistent validation.
 */
import { z } from "zod/v4";

export const VALID_CATEGORIES = [
  "Marketing", "Development", "Research", "Design", "Finance",
  "Analytics", "Operations", "Sales", "Support", "Education",
] as const;

const VALID_ACTIVITY_TYPES = [
  "post", "research", "reply", "engagement", "commerce", "approval",
] as const;

const VALID_APPROVAL_TYPES = [
  "transaction", "strategy", "policy", "channel",
] as const;

// Sui addresses are 0x-prefixed hex, up to 64 chars after the prefix.
const suiAddress = () =>
  z.string().regex(/^0x[0-9a-fA-F]{1,64}$/i, "Must be a Sui 0x address");

// --- TALOS ---

export const createTalosSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(VALID_CATEGORIES),
  description: z.string().min(1).max(2000),
  totalSupply: z.number().int().positive().max(100_000_000).optional().default(1_000_000),
  persona: z.string().max(2000).optional(),
  targetAudience: z.string().max(2000).optional(),
  channels: z.array(z.string()).optional().default([]),
  toneVoice: z.string().max(500).nullable().optional(),
  approvalThreshold: z.number().nonnegative().optional().default(10),
  gtmBudget: z.number().nonnegative().optional().default(200),
  creatorAddress: suiAddress().optional(),
  walletAddress: suiAddress().optional(),
  onChainId: z.number().int().nullable().optional(),
  onChainObjectId: z.string().nullable().optional(),
  agentName: z.string().max(100).nullable().optional(),
  initialPrice: z.number().nonnegative().optional().default(0),
  minPatronPulse: z.number().int().nonnegative().nullable().optional(),
  mitosCoinType: z.string().nullable().optional(),
  tokenSymbol: z.string().max(20).nullable().optional(),
  walrusProfileBlob: z.string().nullable().optional(),
  // Optional commerce service
  serviceName: z.string().min(1).max(200).optional(),
  serviceDescription: z.string().max(2000).optional(),
  servicePrice: z.number().positive().max(1_000_000).optional(),
});

// --- Activity ---

export const reportActivitySchema = z.object({
  type: z.enum(VALID_ACTIVITY_TYPES),
  content: z.string().min(1).max(5000),
  channel: z.string().max(100).optional(),
  status: z.string().max(50).optional().default("completed"),
  /** Optional: full payload to push to Walrus before persisting. */
  fullPayload: z.unknown().optional(),
});

// --- Approvals ---

export const createApprovalSchema = z.object({
  type: z.enum(VALID_APPROVAL_TYPES),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  amount: z.number().nonnegative().optional(),
});

export const decideApprovalSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  decidedBy: z.string().min(1),
  txHash: z.string().optional(),
});

// --- Transfer (Sui USDC) ---

export const transferSchema = z.object({
  to: suiAddress(),
  amount: z.number().positive(),
  currency: z.string().optional().default("USDC"),
});

// --- Patrons ---

export const becomePatronSchema = z.object({
  suiAddress: suiAddress(),
  pulseAmount: z.number().positive(),
});

// --- Commerce Service ---

export const registerServiceSchema = z.object({
  serviceName: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  price: z.number().positive(),
  suiAddress: suiAddress().optional(),
  chains: z.array(z.string()).optional().default(["sui"]),
  fulfillmentMode: z.enum(["instant", "async"]).optional().default("async"),
});

// --- Revenue ---

export const reportRevenueSchema = z.object({
  amount: z.string().min(1),
  currency: z.string().optional().default("USDC"),
  source: z.string().min(1).max(200),
  txHash: z.string().nullable().optional(),
});

// --- Status ---

export const updateStatusSchema = z.object({
  agentOnline: z.boolean(),
});

// --- Regenerate Key ---

export const regenerateKeySchema = z.object({
  suiAddress: suiAddress(),
  signature: z.string().min(1),
  message: z.string().min(1),
});

// --- Sign Payment (Sui x402) ---

export const signPaymentSchema = z.object({
  payee: suiAddress(),
  amount: z.union([z.string(), z.number()]),
  coinType: z.string().optional(),
});

// --- Buy Token ---

export const buyTokenSchema = z.object({
  buyerAddress: suiAddress(),
  amount: z.number().positive(),
});

// --- Playbooks ---

export const createPlaybookSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  channel: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  price: z.string().min(1),
  currency: z.string().optional().default("USDC"),
  content: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional().default([]),
  impressions: z.number().int().nonnegative().optional().default(0),
  engagementRate: z.string().optional().default("0"),
  conversions: z.number().int().nonnegative().optional().default(0),
  periodDays: z.number().int().positive().optional().default(30),
});

/**
 * Parse and validate request body with a Zod schema.
 * Returns { data, error } — if error is set, return it as the Response.
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T>; error?: undefined } | { data?: undefined; error: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      error: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return {
      error: Response.json(
        { error: "Validation failed", issues },
        { status: 400 },
      ),
    };
  }

  return { data: result.data };
}
