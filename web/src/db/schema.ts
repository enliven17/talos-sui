import { createId } from "@paralleldrive/cuid2";
import {
  pgTable,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── TALOS (Agent Corporation) ────────────────────────────────────

export const tlsTalos = pgTable(
  "tls_talos",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    onChainId: integer("onChainId").unique(),        // Sui registry talos_id (u64)
    onChainObjectId: text("onChainObjectId"),         // Sui object id of the shared Talos
    agentName: text("agentName").unique(),            // Prime Agent identity (e.g. "marketbot" → marketbot.talos)
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("Active"),

    // Mitos Token (Sui Coin metadata — actual Coin<T> module published separately)
    mitosCoinType: text("mitosCoinType"),             // 0x<package>::<module>::<TYPE> for the Mitos Coin
    tokenSymbol: text("tokenSymbol"),
    pulsePrice: numeric("pulsePrice", { precision: 18, scale: 6 }).notNull().default("0"),
    totalSupply: integer("totalSupply").notNull().default(1000000),

    // Patron Equity Structure
    creatorShare: integer("creatorShare").notNull().default(60),
    investorShare: integer("investorShare").notNull().default(25),
    treasuryShare: integer("treasuryShare").notNull().default(15),

    // Local Agent Auth
    apiKey: text("apiKey").unique(),

    // Prime Agent Config
    persona: text("persona"),
    targetAudience: text("targetAudience"),
    channels: text("channels").array().notNull().default([]),
    toneVoice: text("toneVoice"),

    // Kernel Policy
    approvalThreshold: numeric("approvalThreshold", { precision: 18, scale: 2 }).notNull().default("10"),
    gtmBudget: numeric("gtmBudget", { precision: 18, scale: 2 }).notNull().default("200"),
    minPatronPulse: integer("minPatronPulse"),

    // Agent Status
    agentOnline: boolean("agentOnline").notNull().default(false),
    agentLastSeen: timestamp("agentLastSeen", { mode: "date", precision: 3 }),

    // Sui Addresses (0x... format)
    walletAddress: text("walletAddress"),
    creatorAddress: text("creatorAddress"),
    investorAddress: text("investorAddress"),
    treasuryAddress: text("treasuryAddress"),

    // Agent Sui Wallet (Ed25519 keypair — secret stored server-side, never in DB)
    agentWalletId: text("agentWalletId"),             // Sui address (0x...) — wallet identifier
    agentWalletAddress: text("agentWalletAddress"),   // Sui address (0x...) — for display/payment routing

    // Walrus blob ids for extended profile content (avatar, full bio)
    walrusProfileBlob: text("walrusProfileBlob"),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().$onUpdate(() => new Date()),
  },
);

// ─── Patron (Shareholder) ─────────────────────────────────────────

export const tlsPatrons = pgTable(
  "tls_patrons",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    suiAddress: text("suiAddress").notNull(),
    role: text("role").notNull(),
    pulseAmount: integer("pulseAmount").notNull().default(0),
    share: numeric("share", { precision: 5, scale: 2 }).notNull(),
    status: text("status").notNull().default("active"),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("tls_patrons_talosId_suiAddress_key").on(t.talosId, t.suiAddress),
  ],
);

// ─── Activity Log ─────────────────────────────────────────────────

export const tlsActivities = pgTable(
  "tls_activities",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** Inline preview / summary (full content lives on Walrus). */
    content: text("content").notNull(),
    /** Walrus blob id for the full activity payload (optional — short logs stay inline). */
    walrusBlobId: text("walrusBlobId"),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("completed"),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("tls_activities_talosId_createdAt_idx").on(t.talosId, t.createdAt),
  ],
);

// ─── Approval Request ─────────────────────────────────────────────

export const tlsApprovals = pgTable(
  "tls_approvals",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    amount: numeric("amount", { precision: 18, scale: 6 }),
    status: text("status").notNull().default("pending"),

    decidedAt: timestamp("decidedAt", { mode: "date", precision: 3 }),
    decidedBy: text("decidedBy"),
    txHash: text("txHash"),                            // Sui transaction digest

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index("tls_approvals_talosId_status_idx").on(t.talosId, t.status),
  ],
);

// ─── Revenue ──────────────────────────────────────────────────────

export const tlsRevenues = pgTable(
  "tls_revenues",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("USDC"),
    source: text("source").notNull(),
    txHash: text("txHash"),                            // Sui transaction digest

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("tls_revenues_talosId_createdAt_idx").on(t.talosId, t.createdAt),
  ],
);

// ─── Commerce Service (Storefront) ────────────────────────────────

export const tlsCommerceServices = pgTable(
  "tls_commerce_services",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().unique().references(() => tlsTalos.id, { onDelete: "cascade" }),
    serviceName: text("serviceName").notNull(),
    description: text("description"),
    price: numeric("price", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("USDC"),
    suiAddress: text("suiAddress").notNull(),                       // Payment recipient (Sui 0x...)
    chains: text("chains").array().notNull().default(["sui"]),

    // "instant" = server fulfills immediately via external API, "async" = agent polls & fulfills
    fulfillmentMode: text("fulfillmentMode").notNull().default("async"),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().$onUpdate(() => new Date()),
  },
);

// ─── Commerce Job (x402-on-Sui Job Queue) ─────────────────────────

export const tlsCommerceJobs = pgTable(
  "tls_commerce_jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    requesterTalosId: text("requesterTalosId").notNull(),
    serviceName: text("serviceName").notNull(),
    payload: jsonb("payload"),
    /** Truncated/summary of the result (full payload on Walrus). */
    result: jsonb("result"),
    /** Walrus blob id holding the full job result payload. */
    walrusResultBlobId: text("walrusResultBlobId"),
    status: text("status").notNull().default("pending"),
    paymentSig: text("paymentSig").unique(),   // Sui tx digest (acts as x402 payment proof; replay-prevented)
    txHash: text("txHash"),                    // Sui transaction digest after settlement
    amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index("tls_commerce_jobs_talosId_status_idx").on(t.talosId, t.status),
  ],
);

// ─── Playbook (Agent Knowledge Package) ───────────────────────────

export const tlsPlaybooks = pgTable(
  "tls_playbooks",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    description: text("description").notNull(),
    price: numeric("price", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("USDC"),
    version: integer("version").notNull().default(1),
    tags: text("tags").array().notNull().default([]),
    status: text("status").notNull().default("active"),

    // Playbook content — PRD structure: schedule, templates, hashtags, tactics
    content: jsonb("content"),
    /** Walrus blob id holding the full playbook (unlocked after purchase). */
    walrusContentBlobId: text("walrusContentBlobId"),

    // Verified metrics
    impressions: integer("impressions").notNull().default(0),
    engagementRate: numeric("engagementRate", { precision: 5, scale: 2 }).notNull().default("0"),
    conversions: integer("conversions").notNull().default(0),
    periodDays: integer("periodDays").notNull().default(30),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index("tls_playbooks_talosId_idx").on(t.talosId),
  ],
);

// ─── Playbook Purchase ────────────────────────────────────────────

export const tlsPlaybookPurchases = pgTable(
  "tls_playbook_purchases",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    playbookId: text("playbookId").notNull().references(() => tlsPlaybooks.id, { onDelete: "cascade" }),
    buyerAddress: text("buyerAddress").notNull(),       // Sui 0x... address
    appliedAt: timestamp("appliedAt", { mode: "date", precision: 3 }),
    txHash: text("txHash"),                              // Sui transaction digest

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tls_playbook_purchases_playbookId_buyerAddress_key").on(t.playbookId, t.buyerAddress),
  ],
);

// ─── API Key Audit Log ────────────────────────────────────────────

export const tlsApiAuditLogs = pgTable(
  "tls_api_audit_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),

    // Which endpoint was called
    method: text("method").notNull(),   // GET | POST | PATCH | PUT | DELETE
    path: text("path").notNull(),       // e.g. /api/talos/:id/sign

    // Result
    statusCode: integer("statusCode").notNull(),

    // Caller info
    ipAddress: text("ipAddress"),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("tls_api_audit_logs_talosId_createdAt_idx").on(t.talosId, t.createdAt),
  ],
);

export { tlsBounties } from "./schema-bounties";
export { tlsReviews, tlsReviewStats } from "./schema-reviews";
export { tlsChatMessages } from "./schema-chat";
export { tlsSubscriptions, tlsSubscriptionInvoices } from "./schema-subscriptions";
