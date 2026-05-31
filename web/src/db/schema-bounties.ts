/**
 * Bounty Board schema — publicly-posted tasks with a USDC reward escrowed
 * by the poster.
 *
 * Escrow model (hackathon shortcut):
 *   - The poster transfers `rewardUsdc` USDC to the operator address as
 *     part of bounty creation (`escrowTxHash` proves the on-chain transfer).
 *   - The DB row tracks lifecycle: open → claimed → completed | cancelled.
 *   - On completion, the operator signs a USDC release from operator →
 *     claimed talos's `agentWalletAddress` (`payoutTxHash` proves it).
 *
 * An on-chain escrow (Move package) would let posters cancel + refund
 * without the operator in the loop, but that's out of scope for the
 * hackathon build. Walrus stores the long-form bounty description and
 * the eventual result payload so the DB row stays small.
 */
import { createId } from "@paralleldrive/cuid2";
import {
  pgTable,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tlsTalos } from "./schema";

// ─── Bounty (Public Task Board) ───────────────────────────────────

export const tlsBounties = pgTable(
  "tls_bounties",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),

    // Poster — the Sui address that escrowed the reward
    posterAddress: text("posterAddress").notNull(),

    // Headline + preview shown in lists; full description lives on Walrus
    title: text("title").notNull(),
    descriptionPreview: text("descriptionPreview").notNull(),
    walrusBlobId: text("walrusBlobId"),

    // One of the 10 marketplace categories (mirrors /launch dropdown):
    // marketing | development | research | design | finance | analytics |
    // operations | sales | support | education
    category: text("category").notNull(),

    // Reward and escrow proof (Sui USDC transfer to operator address)
    rewardUsdc: numeric("rewardUsdc", { precision: 18, scale: 6 }).notNull(),
    escrowTxHash: text("escrowTxHash").notNull(),

    // Lifecycle — open | claimed | completed | cancelled
    status: text("status").notNull().default("open"),

    // Claim
    claimedByTalosId: text("claimedByTalosId").references(() => tlsTalos.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimedAt", { mode: "date", precision: 3 }),

    // Completion + payout
    completedAt: timestamp("completedAt", { mode: "date", precision: 3 }),
    completionWalrusBlobId: text("completionWalrusBlobId"),
    payoutTxHash: text("payoutTxHash"),

    // Expiry — after this the bounty is no longer claimable
    expiresAt: timestamp("expiresAt", { mode: "date", precision: 3 }),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("tls_bounties_status_createdAt_idx").on(t.status, t.createdAt),
    index("tls_bounties_claimedByTalosId_idx").on(t.claimedByTalosId),
  ],
);

// ─── Relations ────────────────────────────────────────────────────

export const bountiesRelations = relations(tlsBounties, ({ one }) => ({
  claimedBy: one(tlsTalos, {
    fields: [tlsBounties.claimedByTalosId],
    references: [tlsTalos.id],
  }),
}));
