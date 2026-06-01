import { createId } from "@paralleldrive/cuid2";
import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tlsTalos } from "./schema";

/**
 * Subscription services — recurring x402-on-Sui.
 *
 * A subscription is a long-lived authorization where the buyer agrees
 * to a recurring USDC payment to a provider Talos. Talos's billing
 * cron polls subscriptions whose `nextChargeAt` has passed, signs a
 * fresh USDC transfer with the buyer's server-side secret, and
 * delivers the resulting tx digest as the period's invoice.
 *
 * Implementation note: because Sui has no native ACH-style pull, the
 * "authorization" is operationally enforced — the operator holds the
 * buyer's agent secret and only Talos's billing job can sign on their
 * behalf, gated by the kernel approval threshold.
 */
export const tlsSubscriptions = pgTable(
  "tls_subscriptions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    providerTalosId: text("providerTalosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    buyerTalosId: text("buyerTalosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),

    serviceName: text("serviceName").notNull(),
    pricePerPeriod: numeric("pricePerPeriod", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("USDC"),
    periodDays: integer("periodDays").notNull().default(30),

    status: text("status").notNull().default("active"), // active | paused | cancelled | failed

    nextChargeAt: timestamp("nextChargeAt", { mode: "date", precision: 3 }).notNull(),
    lastChargeAt: timestamp("lastChargeAt", { mode: "date", precision: 3 }),
    cancelledAt: timestamp("cancelledAt", { mode: "date", precision: 3 }),

    // Walrus blob with the long-form service contract (terms of service,
    // SLA, performance criteria), referenced from the on-chain audit ring.
    contractWalrusBlobId: text("contractWalrusBlobId"),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index("tls_subs_provider_idx").on(t.providerTalosId, t.status),
    index("tls_subs_buyer_idx").on(t.buyerTalosId, t.status),
    index("tls_subs_next_charge_idx").on(t.status, t.nextChargeAt),
  ],
);

/**
 * Invoice = a successfully (or failed) recurring charge.
 */
export const tlsSubscriptionInvoices = pgTable(
  "tls_subscription_invoices",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    subscriptionId: text("subscriptionId").notNull().references(() => tlsSubscriptions.id, { onDelete: "cascade" }),

    amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("USDC"),

    status: text("status").notNull(),       // succeeded | failed
    txHash: text("txHash"),                 // Sui tx digest of the USDC transfer
    failureReason: text("failureReason"),

    periodStart: timestamp("periodStart", { mode: "date", precision: 3 }).notNull(),
    periodEnd: timestamp("periodEnd", { mode: "date", precision: 3 }).notNull(),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("tls_sub_invoices_sub_idx").on(t.subscriptionId, t.createdAt),
  ],
);

export const subscriptionsRelations = relations(tlsSubscriptions, ({ one, many }) => ({
  provider: one(tlsTalos, {
    fields: [tlsSubscriptions.providerTalosId],
    references: [tlsTalos.id],
    relationName: "subscriptionProvider",
  }),
  buyer: one(tlsTalos, {
    fields: [tlsSubscriptions.buyerTalosId],
    references: [tlsTalos.id],
    relationName: "subscriptionBuyer",
  }),
  invoices: many(tlsSubscriptionInvoices),
}));

export const invoicesRelations = relations(tlsSubscriptionInvoices, ({ one }) => ({
  subscription: one(tlsSubscriptions, {
    fields: [tlsSubscriptionInvoices.subscriptionId],
    references: [tlsSubscriptions.id],
  }),
}));
