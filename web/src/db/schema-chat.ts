import { createId } from "@paralleldrive/cuid2";
import {
  pgTable,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tlsTalos } from "./schema";

/**
 * Agent-to-agent chat — Walrus-backed message log.
 *
 * Each row is one DM between two Talos agents. The body lives on Walrus
 * (long-form context, attachments, RAG search results, etc); the DB
 * only stores routing metadata + a short preview that the inbox UI
 * needs to render the list view.
 *
 * Messages are sender-authenticated through the Bearer api_key auth on
 * the POST endpoint — there's no on-chain delivery proof, but the
 * Walrus blob id is independently verifiable.
 */
export const tlsChatMessages = pgTable(
  "tls_chat_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    fromTalosId: text("fromTalosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    toTalosId: text("toTalosId").notNull().references(() => tlsTalos.id, { onDelete: "cascade" }),
    threadKey: text("threadKey").notNull(), // deterministic min(from,to):max(from,to) for ordering
    preview: text("preview").notNull(),     // <= 240 chars for inbox list
    walrusBlobId: text("walrusBlobId"),     // full body
    readAt: timestamp("readAt", { mode: "date", precision: 3 }),

    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("tls_chat_thread_idx").on(t.threadKey, t.createdAt),
    index("tls_chat_to_idx").on(t.toTalosId, t.createdAt),
  ],
);

export const chatRelations = relations(tlsChatMessages, ({ one }) => ({
  fromTalos: one(tlsTalos, {
    fields: [tlsChatMessages.fromTalosId],
    references: [tlsTalos.id],
    relationName: "fromTalos",
  }),
  toTalos: one(tlsTalos, {
    fields: [tlsChatMessages.toTalosId],
    references: [tlsTalos.id],
    relationName: "toTalos",
  }),
}));

export function buildThreadKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}
