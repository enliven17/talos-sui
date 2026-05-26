/**
 * Sliding window rate limiter.
 *
 * Two storage backends:
 *   1. Vercel KV — when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set,
 *      a multi-region Redis-compatible store. Use this in production.
 *   2. In-memory — fallback for dev / single Vercel instance.
 *
 * Usage:
 *   const result = await rateLimit(ip, { limit: 60, windowMs: 60_000 });
 *   if (!result.ok) return rateLimitResponse(result);
 */

const KV_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_KV = !!(KV_URL && KV_TOKEN);

interface Window {
  count: number;
  resetAt: number;
}

// Process-local store: key → sliding window state
const store = new Map<string, Window>();

// Prune expired entries every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of store) {
    if (win.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  /** Max requests allowed per window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix ms
}

/**
 * Sync rate-limit (in-memory backend). Use this in code paths that
 * cannot await — e.g. Next.js middleware on the edge.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  let win = store.get(key);

  if (!win || win.resetAt < now) {
    win = { count: 1, resetAt: now + windowMs };
    store.set(key, win);
  } else {
    win.count += 1;
  }

  return {
    ok: win.count <= limit,
    limit,
    remaining: Math.max(0, limit - win.count),
    resetAt: win.resetAt,
  };
}

/**
 * Async rate-limit (KV-backed when configured, in-memory fallback).
 * Use this from route handlers; falls back to the sync limiter when KV
 * is unavailable so existing callers don't need to special-case.
 *
 * KV implementation uses Upstash's REST API directly so we don't take a
 * compile-time dep on `@vercel/kv` — keeps the bundle small.
 */
export async function rateLimitAsync(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  if (!HAS_KV) return rateLimit(key, { limit, windowMs });

  const ttlSeconds = Math.ceil(windowMs / 1000);
  const kvKey = `talos:rl:${key}`;
  try {
    // Pipeline: INCR + EXPIRE NX (only set TTL on first hit).
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", kvKey],
        ["EXPIRE", kvKey, ttlSeconds, "NX"],
        ["PTTL", kvKey],
      ]),
    });
    const body = (await res.json()) as Array<{ result: number | string }>;
    const count = Number(body[0]?.result ?? 1);
    const pttl = Number(body[2]?.result ?? windowMs);
    const resetAt = Date.now() + Math.max(pttl, 0);
    return {
      ok: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch {
    // KV unreachable — degrade gracefully to the in-memory store.
    return rateLimit(key, { limit, windowMs });
  }
}

export function rateLimitBackend(): "kv" | "memory" {
  return HAS_KV ? "kv" : "memory";
}

/** Build a 429 Response with standard rate-limit headers */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
      },
    },
  );
}
