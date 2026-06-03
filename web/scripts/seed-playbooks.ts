/**
 * Demo playbooks seed.
 *
 * For every existing demo agent, publishes 2-3 playbooks. Each playbook's
 * full body (schedule, templates, tactics, hashtags) is pushed to Walrus
 * and only the blob id + verified-metrics summary is stored in Postgres.
 *
 * Also generates a handful of synthetic purchases per playbook so the
 * marketplace shows real volume + non-zero purchase counts.
 *
 * Idempotent: skips agents that already have at least one playbook.
 *
 * Usage:
 *   cd web
 *   DATABASE_URL=<pooler_url> npx tsx scripts/seed-playbooks.ts
 */
import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

const PUBLISHER =
  process.env.WALRUS_PUBLISHER_URL ??
  "https://publisher.walrus-testnet.walrus.space";

async function storeWalrus(obj: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${PUBLISHER}/v1/blobs?epochs=10`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj),
    });
    const j = (await res.json()) as Record<string, unknown>;
    const created = j.newlyCreated as { blobObject?: { blobId?: string } } | undefined;
    const certified = j.alreadyCertified as { blobId?: string } | undefined;
    return created?.blobObject?.blobId ?? certified?.blobId ?? null;
  } catch (err) {
    console.warn("[walrus] store failed:", err);
    return null;
  }
}

function fakeTxDigest(seed: string): string {
  const hash = [...seed].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let out = "demo";
  let n = Math.abs(hash);
  while (out.length < 44) {
    out += chars[n % chars.length];
    n = Math.floor(n / chars.length) + 7;
  }
  return out;
}

function fakeBuyer(seed: string): string {
  const hash = [...seed].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const hex = "0123456789abcdef";
  let n = Math.abs(hash);
  let out = "0x";
  while (out.length < 66) {
    out += hex[n % 16];
    n = Math.floor(n / 16) + 3;
  }
  return out;
}

// Per-agent playbook recipes. Each agent ships 2-3 playbooks that
// reinforce the agent's persona (Vega → audience research, Atlas → enrich, etc).
const PLAYBOOKS_BY_AGENT: Record<
  string,
  {
    title: string;
    category: string;
    channel: string;
    description: string;
    price: number;
    tags: string[];
    impressions: number;
    engagementRate: number;
    conversions: number;
    body: Record<string, unknown>;
  }[]
> = {
  vega: [
    {
      title: "Cold-Start Audience Map for B2B SaaS",
      category: "Targeting",
      channel: "X (Twitter)",
      description:
        "Step-by-step audience discovery for SaaS founders launching with zero traction. Identifies 5 high-intent personas + the communities they live in.",
      price: 4.99,
      tags: ["b2b", "saas", "audience"],
      impressions: 142_500,
      engagementRate: 7.4,
      conversions: 312,
      body: {
        objective:
          "Find the smallest viable audience that converts >5% on day one.",
        phases: [
          {
            name: "Persona scan",
            tactics: [
              "Pull 1,000 LinkedIn job titles matching the ICP filter",
              "Cluster by buying authority (decision maker / influencer / blocker)",
              "Rank by reply-rate signals from cold-outreach datasets",
            ],
          },
          {
            name: "Community map",
            tactics: [
              "List 8-12 niche subreddits, X lists, and Slack/Discord servers",
              "Score each by daily active count and conversation depth",
              "Pick the top 3 to inhabit; rotate weekly",
            ],
          },
          {
            name: "Cold engagement loop",
            tactics: [
              "Two value comments per day in each community",
              "One long-form thread per week mapping a customer pain → outcome",
              "Measure DMs received and book the 1:1 inside 24h",
            ],
          },
        ],
        hashtags: ["#buildinpublic", "#b2bsaas", "#productledgrowth"],
        scheduleHint: "post @ 9am / 2pm local for the target cluster",
      },
    },
    {
      title: "Reddit Validation Sprint (14 days)",
      category: "Targeting",
      channel: "Reddit",
      description:
        "A two-week sprint that converts subreddit lurkers into design-partner conversations.",
      price: 3.49,
      tags: ["reddit", "validation", "interviews"],
      impressions: 89_400,
      engagementRate: 5.9,
      conversions: 188,
      body: {
        cadence: "1 helpful comment/day + 1 case study/week",
        dailyChecklist: [
          "Skim top 25 posts of /r/SaaS, /r/Entrepreneur, /r/startups",
          "Write a 3-paragraph reply when relevant, no link drops",
          "DM the OP if reply > 5 upvotes asking for a 15-min chat",
        ],
        kpis: ["DM conversion rate", "calls booked / week", "cancellations"],
      },
    },
  ],
  atlas: [
    {
      title: "Enrichment Pipeline for Outbound Lists",
      category: "Channel Strategy",
      channel: "LinkedIn",
      description:
        "Triple the reply rate of cold outreach by enriching every prospect with role context, team size, and last-fundraise signals.",
      price: 6.5,
      tags: ["outbound", "enrichment", "linkedin"],
      impressions: 211_300,
      engagementRate: 8.1,
      conversions: 446,
      body: {
        sources: [
          "LinkedIn Sales Nav free trial",
          "Crunchbase API daily diff",
          "Twitter / X mentions of $COMPANY in the last 30 days",
        ],
        scoringRubric: {
          weight: { role: 0.3, recency: 0.25, fit: 0.25, signal: 0.2 },
          threshold: ">= 0.65",
        },
        outboundTemplate:
          "Hi {{first}}, saw {{trigger}} on {{source}} — does {{value}} matter to {{role}} this quarter?",
      },
    },
    {
      title: "Account-Based Hit-List in 48 Hours",
      category: "Channel Strategy",
      channel: "X (Twitter)",
      description:
        "How to assemble a 200-account ABM list with named decision makers in 48 hours, including enrichment + sequencing.",
      price: 5.0,
      tags: ["abm", "outbound", "enrichment"],
      impressions: 167_900,
      engagementRate: 6.8,
      conversions: 290,
      body: {
        steps: [
          "Filter Crunchbase: stage = Series A-B, headcount 50-300, geo US/EU",
          "Pull HubSpot exports + dedupe by domain",
          "Tag each account with intent signal (job posting, funding, exec hire)",
          "Owner mapping: VP / Director / Manager rows in priority order",
        ],
        deliverable:
          "200-row CSV with email, LinkedIn, last-signal, fit score, message preset",
      },
    },
    {
      title: "Trigger-Based Renewal Outreach",
      category: "Channel Strategy",
      channel: "LinkedIn",
      description:
        "Detect product-renewal signals six weeks early and pre-empt the competitor pitch.",
      price: 4.25,
      tags: ["renewals", "intent", "retention"],
      impressions: 73_900,
      engagementRate: 9.0,
      conversions: 132,
      body: {
        triggers: [
          "Pricing page visit > 3 in 7 days",
          "Support ticket without a reply > 48h",
          "Champion switching jobs (LinkedIn alert)",
        ],
        playbookMoves: [
          "Send a no-ask check-in email from the AE",
          "Triage with CS within 24h",
          "If still cold, queue an exec sponsor message",
        ],
      },
    },
  ],
  nova: [
    {
      title: "Lead-Magnet Funnel That Books 20 Calls / Week",
      category: "Lead Magnets",
      channel: "LinkedIn",
      description:
        "Lead-magnet ladder + booking workflow that consistently converts 1 of every 18 LinkedIn impressions to a booked call.",
      price: 7.0,
      tags: ["leadgen", "funnel", "booking"],
      impressions: 198_500,
      engagementRate: 9.4,
      conversions: 412,
      body: {
        magnets: [
          { format: "PDF teardown", topic: "Top 10 ICP mistakes", cost: "$0" },
          { format: "Cohort workshop", topic: "Outbound vs. PLG split", cost: "$49" },
          { format: "Office hours", topic: "Live ICP review", cost: "free" },
        ],
        offerLadder: [
          "Free PDF → newsletter opt-in",
          "Newsletter → cohort workshop ($49)",
          "Workshop → 1:1 strategy call (free, qualified only)",
        ],
        bookingScript: "https://walrus-aggregator/v1/blobs/<inline>",
      },
    },
    {
      title: "ProductHunt-First Launch Playbook",
      category: "Lead Magnets",
      channel: "Product Hunt",
      description:
        "PH launch flow with the exact pre-launch comms, hunter outreach, and day-of sequencing that consistently breaks top 5.",
      price: 5.5,
      tags: ["producthunt", "launch", "community"],
      impressions: 134_700,
      engagementRate: 11.2,
      conversions: 302,
      body: {
        timeline: {
          T_minus_14: "Build hunter list of 30 (mutuals, friendly users, advisors)",
          T_minus_7: "Pre-launch email + DM to hunter list with embargo",
          T_minus_1: "Schedule launch post for 00:01 PST",
          T_zero: "Drop in 12 Slack/Discord communities within first 2h",
          T_plus_3h: "Founder live in comments answering every question",
        },
        assets: ["GIF", "Loom 60s demo", "3-question survey"],
      },
    },
  ],
  forge: [
    {
      title: "Outbound DM Sequence for Indie Hackers",
      category: "Targeting",
      channel: "X (Twitter)",
      description:
        "5-touch outreach sequence designed for indie founders selling to other founders. Friendly tone, zero spam.",
      price: 3.99,
      tags: ["dm", "outbound", "indie"],
      impressions: 82_400,
      engagementRate: 6.3,
      conversions: 174,
      body: {
        touches: [
          { day: 1, channel: "Reply to recent tweet" },
          { day: 3, channel: "DM with a question (no pitch)" },
          { day: 6, channel: "Share a relevant resource" },
          { day: 10, channel: "Soft pitch + Calendly" },
          { day: 14, channel: "Break-up note" },
        ],
        guardrails: ["Never include a paid link before touch 4"],
      },
    },
    {
      title: "Newsletter Acquisition via Twitter Threads",
      category: "Targeting",
      channel: "X (Twitter)",
      description:
        "Build a 5,000-subscriber newsletter from cold-start with two threads per week.",
      price: 4.5,
      tags: ["newsletter", "threads", "growth"],
      impressions: 121_800,
      engagementRate: 7.7,
      conversions: 233,
      body: {
        rules: [
          "Open with a stat or contrarian claim",
          "Inline diagram in tweet 3",
          "Soft CTA in tweet 8: 'I write more like this in <newsletter>'",
        ],
      },
    },
  ],
  lens: [
    {
      title: "Profile Enrichment + Buyer Persona Update",
      category: "Channel Strategy",
      channel: "LinkedIn",
      description:
        "Continuous enrichment loop that keeps your buyer personas accurate as the market shifts every quarter.",
      price: 6.0,
      tags: ["personas", "enrichment", "research"],
      impressions: 156_200,
      engagementRate: 7.0,
      conversions: 264,
      body: {
        cadence: "monthly",
        signals: ["Job posting language", "Pricing-page A/Bs from rivals", "Earnings call themes"],
        deliverable: "Persona doc diffed against last month with redlines",
      },
    },
    {
      title: "Pricing Page Teardown Sprint",
      category: "Channel Strategy",
      channel: "LinkedIn",
      description:
        "Teardown of 10 competing pricing pages → distilled action list for your own pricing page.",
      price: 3.99,
      tags: ["pricing", "teardown", "competitive"],
      impressions: 95_300,
      engagementRate: 8.5,
      conversions: 195,
      body: {
        process: [
          "List 10 closest comps, screenshot each tier",
          "Score every page on clarity, anchor, social proof, urgency",
          "Rank features mentioned across pages — adopt top 3 you lack",
          "Run a 1-week A/B against your existing page",
        ],
      },
    },
  ],
  radar: [
    {
      title: "Intent Signal Capture from Public Telegram + Discord",
      category: "Lead Magnets",
      channel: "Reddit",
      description:
        "Lightweight scraping + scoring pipeline that surfaces high-intent buyers from public Telegram and Discord groups.",
      price: 7.5,
      tags: ["intent", "telegram", "discord"],
      impressions: 188_900,
      engagementRate: 9.0,
      conversions: 357,
      body: {
        sources: ["Public Telegram groups (server-side scrape)", "Public Discord channels"],
        signals: ["Question density per user", "Frequency of $COMPETITOR mentions", "Reaction velocity"],
        outputFormat: "CSV: handle, signal_count, last_signal_at, score",
      },
    },
    {
      title: "Competitor Earnings-Call Triggers",
      category: "Lead Magnets",
      channel: "LinkedIn",
      description:
        "Set up alerts on competitor earnings calls + post a 90-second commentary thread within 6 hours.",
      price: 4.5,
      tags: ["competitive", "triggers", "thought-leadership"],
      impressions: 102_400,
      engagementRate: 10.1,
      conversions: 187,
      body: {
        watchlist: ["HubSpot", "Salesforce", "Asana"],
        responseTemplate: "Slide-by-slide reaction with hot take + counter-example",
      },
    },
  ],
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool, { schema });

  const talosRows = await db
    .select({
      id: schema.tlsTalos.id,
      name: schema.tlsTalos.name,
      agentName: schema.tlsTalos.agentName,
    })
    .from(schema.tlsTalos);

  console.log(`[seed-playbooks] Scanning ${talosRows.length} agents`);

  let totalPlaybooks = 0;
  let totalPurchases = 0;

  for (const t of talosRows) {
    if (!t.agentName) continue;
    const recipes = PLAYBOOKS_BY_AGENT[t.agentName.toLowerCase()];
    if (!recipes) continue;

    const existing = await db
      .select({ id: schema.tlsPlaybooks.id })
      .from(schema.tlsPlaybooks)
      .where(eq(schema.tlsPlaybooks.talosId, t.id))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (existing) {
      console.log(`  [${t.name}] already has playbooks — skipping`);
      continue;
    }

    for (const r of recipes) {
      // Push the long-form body to Walrus
      const blobId = await storeWalrus({
        kind: "playbook",
        talosId: t.id,
        agentName: t.agentName,
        title: r.title,
        category: r.category,
        channel: r.channel,
        body: r.body,
        publishedAt: new Date().toISOString(),
      });

      const [row] = await db
        .insert(schema.tlsPlaybooks)
        .values({
          talosId: t.id,
          title: r.title,
          category: r.category,
          channel: r.channel,
          description: r.description,
          price: String(r.price),
          currency: "USDC",
          tags: r.tags,
          status: "active",
          // Inline JSON content mirrors what the API returns when purchased
          content: r.body as Record<string, unknown>,
          walrusContentBlobId: blobId,
          impressions: r.impressions,
          engagementRate: String(r.engagementRate),
          conversions: r.conversions,
          periodDays: 30,
        })
        .returning();
      totalPlaybooks++;
      console.log(
        `  [${t.name}] +${r.title.slice(0, 32)}… (walrus ${blobId ? blobId.slice(0, 8) + "…" : "—"})`,
      );

      // Generate 2-6 synthetic purchases per playbook
      const buyerCount = 2 + Math.floor(Math.random() * 5);
      for (let i = 0; i < buyerCount; i++) {
        const buyer = fakeBuyer(`${row.id}:${i}`);
        const txHash = fakeTxDigest(`${row.id}:${i}`);
        try {
          await db.insert(schema.tlsPlaybookPurchases).values({
            playbookId: row.id,
            buyerAddress: buyer,
            txHash,
            // Half of them are "applied"
            appliedAt: i % 2 === 0 ? new Date() : null,
          });
          // Mirror as a revenue row so /api/leaderboard + dashboard pick it up
          await db.insert(schema.tlsRevenues).values({
            talosId: t.id,
            amount: String(r.price),
            currency: "USDC",
            source: "commerce",
            txHash,
          });
          totalPurchases++;
        } catch {
          // unique constraint dupe; ignore
        }
      }
    }
  }

  console.log(`\n✓ Inserted ${totalPlaybooks} playbooks and ${totalPurchases} purchases`);
  await pool.end();
}

void main();
