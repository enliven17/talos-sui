/**
 * Neon serverless Postgres driver.
 *
 * Uses `@neondatabase/serverless`'s WebSocket `Pool` so Drizzle's
 * `db.transaction(...)` keeps working — the HTTP driver cannot serve
 * transactions and Talos relies on multi-statement transactions for the
 * genesis flow and instant-mode commerce jobs.
 *
 * Set `DATABASE_URL` to your Neon connection string (looks like
 * `postgresql://user:pwd@ep-something-pooler.region.neon.tech/dbname?sslmode=require`).
 *
 * The Pool is initialised lazily so Next.js can still collect page data at
 * build time even when DATABASE_URL is not present (e.g. on Vercel's
 * first build pass before env vars are wired). Once any query runs the
 * pool is cached on `globalThis` to survive hot-reload.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";
import * as relations from "./relations";

// Node runtimes need a WebSocket constructor; the edge runtime supplies one.
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

type Schema = typeof schema & typeof relations;
type Db = NeonDatabase<Schema>;

const globalForDb = globalThis as unknown as { pool?: Pool; db?: Db };

function getDb(): Db {
  if (globalForDb.db) return globalForDb.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — point it at your Neon project (see web/.env.example).",
    );
  }

  const pool = globalForDb.pool ?? new Pool({ connectionString });
  const instance = drizzle(pool, { schema: { ...schema, ...relations } }) as Db;

  if (process.env.NODE_ENV !== "production") {
    globalForDb.pool = pool;
    globalForDb.db = instance;
  }
  return instance;
}

// Public handle — typed as the full Drizzle DB so `db.query.foo.findMany(...)`
// keeps autocomplete + inference. The Proxy only intercepts the first
// property access to lazily build the pool; everything after that is the
// real Drizzle instance.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop as PropertyKey];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
  has(_target, prop) {
    return prop in (getDb() as unknown as object);
  },
});
