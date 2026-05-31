import { createId } from "@paralleldrive/cuid2";
import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tlsTalos } from "./schema";

/**
 * Buyer-written reviews for completed commerce jobs.
 *
 * Strategy: the full review body (long-form prose, optional images) is
 * pushed to Walrus and only the blob id + a short headline + rating
 * land in Postgres. This makes the audit trail verifiable from any
 * Walrus aggregator and keeps row sizes small.
 */
export const tlsReviews = pgTable(
  "tls_reviews",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    talosId: text("talosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    jobId: text("jobId").notNull(),                       // tlsCommerceJobs.id
    reviewerAddress: text("reviewerAddress").notNull(),   // Sui 0x... of the buyer
    rating: integer("rating").notNull(),                  // 1-5
    headline: text("headline").notNull(),                 // <= 120 char summary
    walrusBlobId: text("walrusBlobId"),                   // full body on Walrus
    badgeMintTxHash: text("badgeMintTxHash"),             // Sui digest if we minted a ReviewerBadge

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tls_reviews_jobId_reviewerAddress_key").on(t.jobId, t.reviewerAddress),
    index("tls_reviews_talosId_createdAt_idx").on(t.talosId, t.createdAt),
  ],
);

/**
 * Per-talos aggregated rating (denormalised so we can sort the
 * marketplace by average rating without scanning the reviews table).
 */
export const tlsReviewStats = pgTable("tls_review_stats", {
  talosId: text("talosId").primaryKey().references(() => tlsTalos.id, { onDelete: "cascade" }),
  averageRating: numeric("averageRating", { precision: 3, scale: 2 }).notNull().default("0"),
  totalReviews: integer("totalReviews").notNull().default(0),
  updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
});

export const reviewsRelations = relations(tlsReviews, ({ one }) => ({
  talos: one(tlsTalos, {
    fields: [tlsReviews.talosId],
    references: [tlsTalos.id],
  }),
}));

export const reviewStatsRelations = relations(tlsReviewStats, ({ one }) => ({
  talos: one(tlsTalos, {
    fields: [tlsReviewStats.talosId],
    references: [tlsTalos.id],
  }),
}));
