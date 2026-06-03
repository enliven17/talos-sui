import { describe, it, expect } from "vitest";
import {
  createTalosSchema,
  reportActivitySchema,
  createApprovalSchema,
  decideApprovalSchema,
  transferSchema,
  becomePatronSchema,
  registerServiceSchema,
  reportRevenueSchema,
  updateStatusSchema,
  regenerateKeySchema,
  signPaymentSchema,
  buyTokenSchema,
  createPlaybookSchema,
  VALID_CATEGORIES,
} from "@/lib/schemas";

const VALID_ADDR = "0x" + "a".repeat(64);

// ─── createTalosSchema ──────────────────────────────────────────────

describe("createTalosSchema", () => {
  it("accepts minimal valid payload and applies defaults", () => {
    const result = createTalosSchema.safeParse({
      name: "My Talos",
      category: "Marketing",
      description: "A helpful agent",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalSupply).toBe(1_000_000);
      expect(result.data.channels).toEqual([]);
      expect(result.data.approvalThreshold).toBe(10);
      expect(result.data.gtmBudget).toBe(200);
      expect(result.data.initialPrice).toBe(0);
    }
  });

  it("accepts every valid category", () => {
    for (const c of VALID_CATEGORIES) {
      const r = createTalosSchema.safeParse({
        name: "X",
        category: c,
        description: "Y",
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects invalid category", () => {
    const result = createTalosSchema.safeParse({
      name: "X",
      category: "NotACategory",
      description: "Y",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = createTalosSchema.safeParse({
      category: "Marketing",
      description: "Y",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 100 chars", () => {
    const result = createTalosSchema.safeParse({
      name: "x".repeat(101),
      category: "Marketing",
      description: "Y",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-hex creatorAddress", () => {
    const result = createTalosSchema.safeParse({
      name: "X",
      category: "Marketing",
      description: "Y",
      creatorAddress: "not-an-address",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative totalSupply", () => {
    const result = createTalosSchema.safeParse({
      name: "X",
      category: "Marketing",
      description: "Y",
      totalSupply: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ─── reportActivitySchema ──────────────────────────────────────────

describe("reportActivitySchema", () => {
  it("accepts a valid post activity", () => {
    const r = reportActivitySchema.safeParse({
      type: "post",
      content: "Hello world",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("completed");
  });

  it("rejects invalid type", () => {
    const r = reportActivitySchema.safeParse({
      type: "tweet",
      content: "Hi",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty content", () => {
    const r = reportActivitySchema.safeParse({
      type: "post",
      content: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects content > 5000 chars", () => {
    const r = reportActivitySchema.safeParse({
      type: "post",
      content: "a".repeat(5001),
    });
    expect(r.success).toBe(false);
  });
});

// ─── createApprovalSchema ──────────────────────────────────────────

describe("createApprovalSchema", () => {
  it("accepts valid approval", () => {
    const r = createApprovalSchema.safeParse({
      type: "transaction",
      title: "Pay vendor",
      amount: 100,
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const r = createApprovalSchema.safeParse({
      type: "unknown",
      title: "T",
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const r = createApprovalSchema.safeParse({
      type: "transaction",
      title: "T",
      amount: -5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing title", () => {
    const r = createApprovalSchema.safeParse({ type: "policy" });
    expect(r.success).toBe(false);
  });
});

// ─── decideApprovalSchema ──────────────────────────────────────────

describe("decideApprovalSchema", () => {
  it("accepts approved status", () => {
    const r = decideApprovalSchema.safeParse({
      status: "approved",
      decidedBy: "0xabc",
    });
    expect(r.success).toBe(true);
  });

  it("accepts rejected status", () => {
    const r = decideApprovalSchema.safeParse({
      status: "rejected",
      decidedBy: "0xabc",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown status", () => {
    const r = decideApprovalSchema.safeParse({
      status: "maybe",
      decidedBy: "0xabc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty decidedBy", () => {
    const r = decideApprovalSchema.safeParse({
      status: "approved",
      decidedBy: "",
    });
    expect(r.success).toBe(false);
  });
});

// ─── transferSchema ──────────────────────────────────────────────────

describe("transferSchema", () => {
  it("accepts valid transfer with default currency", () => {
    const r = transferSchema.safeParse({ to: VALID_ADDR, amount: 5 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("USDC");
  });

  it("rejects zero amount", () => {
    const r = transferSchema.safeParse({ to: VALID_ADDR, amount: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects invalid sui address", () => {
    const r = transferSchema.safeParse({ to: "0xZZZ", amount: 1 });
    expect(r.success).toBe(false);
  });
});

// ─── becomePatronSchema ─────────────────────────────────────────────

describe("becomePatronSchema", () => {
  it("accepts valid patron payload", () => {
    const r = becomePatronSchema.safeParse({
      suiAddress: VALID_ADDR,
      pulseAmount: 1000,
    });
    expect(r.success).toBe(true);
  });

  it("rejects zero pulseAmount", () => {
    const r = becomePatronSchema.safeParse({
      suiAddress: VALID_ADDR,
      pulseAmount: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid sui address", () => {
    const r = becomePatronSchema.safeParse({
      suiAddress: "nope",
      pulseAmount: 1,
    });
    expect(r.success).toBe(false);
  });
});

// ─── registerServiceSchema ──────────────────────────────────────────

describe("registerServiceSchema", () => {
  it("accepts a minimal service registration with defaults", () => {
    const r = registerServiceSchema.safeParse({
      serviceName: "My Service",
      price: 1,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.chains).toEqual(["sui"]);
      expect(r.data.fulfillmentMode).toBe("async");
    }
  });

  it("rejects zero/negative price", () => {
    const r = registerServiceSchema.safeParse({
      serviceName: "S",
      price: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fulfillmentMode", () => {
    const r = registerServiceSchema.safeParse({
      serviceName: "S",
      price: 1,
      fulfillmentMode: "magic",
    });
    expect(r.success).toBe(false);
  });
});

// ─── reportRevenueSchema ────────────────────────────────────────────

describe("reportRevenueSchema", () => {
  it("accepts valid revenue (string amount)", () => {
    const r = reportRevenueSchema.safeParse({
      amount: "100.5",
      source: "commerce",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("USDC");
  });

  it("rejects empty amount string", () => {
    const r = reportRevenueSchema.safeParse({ amount: "", source: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects missing source", () => {
    const r = reportRevenueSchema.safeParse({ amount: "1" });
    expect(r.success).toBe(false);
  });

  it("rejects numeric amount (schema requires string)", () => {
    const r = reportRevenueSchema.safeParse({
      amount: 100,
      source: "commerce",
    });
    expect(r.success).toBe(false);
  });
});

// ─── updateStatusSchema ─────────────────────────────────────────────

describe("updateStatusSchema", () => {
  it("accepts agentOnline true", () => {
    const r = updateStatusSchema.safeParse({ agentOnline: true });
    expect(r.success).toBe(true);
  });

  it("accepts agentOnline false", () => {
    const r = updateStatusSchema.safeParse({ agentOnline: false });
    expect(r.success).toBe(true);
  });

  it("rejects non-boolean agentOnline", () => {
    const r = updateStatusSchema.safeParse({ agentOnline: "yes" });
    expect(r.success).toBe(false);
  });

  it("rejects missing field", () => {
    const r = updateStatusSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

// ─── regenerateKeySchema ────────────────────────────────────────────

describe("regenerateKeySchema", () => {
  it("accepts a valid payload", () => {
    const r = regenerateKeySchema.safeParse({
      suiAddress: VALID_ADDR,
      signature: "sig",
      message: "msg",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid sui address", () => {
    const r = regenerateKeySchema.safeParse({
      suiAddress: "bad",
      signature: "sig",
      message: "msg",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty signature", () => {
    const r = regenerateKeySchema.safeParse({
      suiAddress: VALID_ADDR,
      signature: "",
      message: "msg",
    });
    expect(r.success).toBe(false);
  });
});

// ─── signPaymentSchema ──────────────────────────────────────────────

describe("signPaymentSchema", () => {
  it("accepts string amount", () => {
    const r = signPaymentSchema.safeParse({
      payee: VALID_ADDR,
      amount: "1.5",
    });
    expect(r.success).toBe(true);
  });

  it("accepts number amount", () => {
    const r = signPaymentSchema.safeParse({
      payee: VALID_ADDR,
      amount: 1.5,
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid payee", () => {
    const r = signPaymentSchema.safeParse({
      payee: "not-an-addr",
      amount: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects boolean amount", () => {
    const r = signPaymentSchema.safeParse({
      payee: VALID_ADDR,
      amount: true,
    });
    expect(r.success).toBe(false);
  });
});

// ─── buyTokenSchema ─────────────────────────────────────────────────

describe("buyTokenSchema", () => {
  it("accepts valid buy", () => {
    const r = buyTokenSchema.safeParse({
      buyerAddress: VALID_ADDR,
      amount: 100,
    });
    expect(r.success).toBe(true);
  });

  it("rejects zero amount", () => {
    const r = buyTokenSchema.safeParse({
      buyerAddress: VALID_ADDR,
      amount: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid buyer address", () => {
    const r = buyTokenSchema.safeParse({
      buyerAddress: "0x",
      amount: 1,
    });
    expect(r.success).toBe(false);
  });
});

// ─── createPlaybookSchema ───────────────────────────────────────────

describe("createPlaybookSchema", () => {
  it("accepts a minimal valid playbook with defaults", () => {
    const r = createPlaybookSchema.safeParse({
      title: "My Playbook",
      category: "Targeting",
      price: "1.00",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.currency).toBe("USDC");
      expect(r.data.tags).toEqual([]);
      expect(r.data.impressions).toBe(0);
      expect(r.data.engagementRate).toBe("0");
      expect(r.data.conversions).toBe(0);
      expect(r.data.periodDays).toBe(30);
    }
  });

  it("rejects missing title", () => {
    const r = createPlaybookSchema.safeParse({
      category: "Targeting",
      price: "1.00",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty price string", () => {
    const r = createPlaybookSchema.safeParse({
      title: "T",
      category: "C",
      price: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative impressions", () => {
    const r = createPlaybookSchema.safeParse({
      title: "T",
      category: "C",
      price: "1",
      impressions: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects zero periodDays", () => {
    const r = createPlaybookSchema.safeParse({
      title: "T",
      category: "C",
      price: "1",
      periodDays: 0,
    });
    expect(r.success).toBe(false);
  });
});
