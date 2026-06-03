import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/sui BEFORE importing the module under test so the mocked
// getSuiClient / getUsdcType / usdcToMicros are used by sui-x402.
const mockGetTransactionBlock = vi.fn();
const mockWaitForTransaction = vi.fn();

const USDC_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

vi.mock("@/lib/sui", () => {
  return {
    getSuiClient: () => ({
      getTransactionBlock: mockGetTransactionBlock,
      waitForTransaction: mockWaitForTransaction,
    }),
    getUsdcType: () => USDC_TYPE,
    usdcToMicros: (h: string | number) => {
      const n = typeof h === "number" ? h.toString() : String(h).trim();
      const [whole, fracRaw = ""] = n.split(".");
      const frac = (fracRaw + "000000").slice(0, 6);
      return BigInt(whole || "0") * 1_000_000n + BigInt(frac || "0");
    },
    // Stubs for unused exports — kept so the module's import list resolves.
    keypairFromSecret: vi.fn(),
  };
});

import {
  parseX402Header,
  buildX402Header,
  verifyX402Payment,
  settleX402Payment,
} from "@/lib/sui-x402";

beforeEach(() => {
  mockGetTransactionBlock.mockReset();
  mockWaitForTransaction.mockReset();
});

// ─── parseX402Header ────────────────────────────────────────────────

describe("parseX402Header", () => {
  it("returns null for null", () => {
    expect(parseX402Header(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseX402Header("")).toBeNull();
  });

  it("parses 'sui-tx <digest>' format", () => {
    expect(parseX402Header("sui-tx ABC123")).toBe("ABC123");
  });

  it("parses 'x402 <digest>' format", () => {
    expect(parseX402Header("x402 XYZ789")).toBe("XYZ789");
  });

  it("returns bare digest when no scheme prefix", () => {
    expect(parseX402Header("bareDigest42")).toBe("bareDigest42");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseX402Header("  sui-tx DIGEST  ")).toBe("DIGEST");
    expect(parseX402Header("  bareDigest  ")).toBe("bareDigest");
  });

  it("trims the digest portion after 'sui-tx '", () => {
    expect(parseX402Header("sui-tx   spaced   ")).toBe("spaced");
  });

  it("is case-sensitive on the scheme prefix", () => {
    // "SUI-TX " is NOT recognised as a scheme, so it falls through to the
    // bare-digest branch and is returned verbatim (trimmed).
    expect(parseX402Header("SUI-TX FOO")).toBe("SUI-TX FOO");
  });
});

// ─── buildX402Header ────────────────────────────────────────────────

describe("buildX402Header", () => {
  it("produces 'sui-tx <token>' format", () => {
    expect(buildX402Header("DIGEST")).toBe("sui-tx DIGEST");
  });

  it("round-trips with parseX402Header", () => {
    const tokens = ["abc", "0xdeadbeef", "9WzSomeDigest12345"];
    for (const t of tokens) {
      expect(parseX402Header(buildX402Header(t))).toBe(t);
    }
  });
});

// ─── verifyX402Payment ──────────────────────────────────────────────

const PAYEE = "0x" + "a".repeat(64);
const PAYER = "0x" + "b".repeat(64);
const OTHER = "0x" + "c".repeat(64);

function successTx({
  amount,
  recipient,
  coinType,
  sender,
  status = "success",
}: {
  amount: string;
  recipient: string;
  coinType: string;
  sender?: string;
  status?: string;
}) {
  return {
    effects: { status: { status } },
    transaction: sender ? { data: { sender } } : undefined,
    balanceChanges: [
      {
        owner: { AddressOwner: recipient },
        coinType,
        amount,
      },
    ],
  };
}

describe("verifyX402Payment", () => {
  it("accepts a tx with correct recipient, amount, and coin type", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "1000000", // 1 USDC
        recipient: PAYEE,
        coinType: USDC_TYPE,
      }),
    );
    const ok = await verifyX402Payment("DIGEST", "1", PAYEE);
    expect(ok).toBe(true);
  });

  it("accepts when actual amount exceeds expected (over-payment)", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "5000000",
        recipient: PAYEE,
        coinType: USDC_TYPE,
      }),
    );
    expect(await verifyX402Payment("DIGEST", "1", PAYEE)).toBe(true);
  });

  it("rejects when recipient differs", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "1000000",
        recipient: OTHER,
        coinType: USDC_TYPE,
      }),
    );
    expect(await verifyX402Payment("DIGEST", "1", PAYEE)).toBe(false);
  });

  it("rejects when amount is insufficient", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "500000", // 0.5 USDC
        recipient: PAYEE,
        coinType: USDC_TYPE,
      }),
    );
    expect(await verifyX402Payment("DIGEST", "1", PAYEE)).toBe(false);
  });

  it("rejects when coinType is wrong (not USDC)", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "1000000",
        recipient: PAYEE,
        coinType: "0x2::sui::SUI",
      }),
    );
    expect(await verifyX402Payment("DIGEST", "1", PAYEE)).toBe(false);
  });

  it("rejects when tx status is not 'success'", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "1000000",
        recipient: PAYEE,
        coinType: USDC_TYPE,
        status: "failure",
      }),
    );
    expect(await verifyX402Payment("DIGEST", "1", PAYEE)).toBe(false);
  });

  it("rejects when effects are missing", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce({
      transaction: { data: { sender: PAYER } },
      balanceChanges: [],
    });
    expect(await verifyX402Payment("DIGEST", "1", PAYEE)).toBe(false);
  });

  it("rejects (returns false) when getTransactionBlock throws (tx not found)", async () => {
    mockGetTransactionBlock.mockRejectedValueOnce(new Error("Not found"));
    expect(await verifyX402Payment("MISSING", "1", PAYEE)).toBe(false);
  });

  it("accepts when expectedFrom matches the sender", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "1000000",
        recipient: PAYEE,
        coinType: USDC_TYPE,
        sender: PAYER,
      }),
    );
    expect(await verifyX402Payment("DIGEST", "1", PAYEE, PAYER)).toBe(true);
  });

  it("rejects when expectedFrom mismatches the sender", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "1000000",
        recipient: PAYEE,
        coinType: USDC_TYPE,
        sender: OTHER,
      }),
    );
    expect(await verifyX402Payment("DIGEST", "1", PAYEE, PAYER)).toBe(false);
  });

  it("is case-insensitive on address comparisons", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce(
      successTx({
        amount: "1000000",
        recipient: PAYEE.toUpperCase(),
        coinType: USDC_TYPE,
        sender: PAYER.toUpperCase(),
      }),
    );
    expect(
      await verifyX402Payment("DIGEST", "1", PAYEE.toLowerCase(), PAYER.toLowerCase()),
    ).toBe(true);
  });

  it("rejects when there are no balance changes for the payee", async () => {
    mockGetTransactionBlock.mockResolvedValueOnce({
      effects: { status: { status: "success" } },
      balanceChanges: [],
    });
    expect(await verifyX402Payment("DIGEST", "1", PAYEE)).toBe(false);
  });
});

// ─── settleX402Payment ──────────────────────────────────────────────

describe("settleX402Payment", () => {
  it("waits for the tx and returns the digest as txHash", async () => {
    mockWaitForTransaction.mockResolvedValueOnce({ digest: "X" });
    const result = await settleX402Payment("PAY_TOKEN");
    expect(result).toEqual({ txHash: "PAY_TOKEN" });
    expect(mockWaitForTransaction).toHaveBeenCalledWith({
      digest: "PAY_TOKEN",
      timeout: 30_000,
    });
  });

  it("propagates errors from waitForTransaction", async () => {
    mockWaitForTransaction.mockRejectedValueOnce(new Error("timeout"));
    await expect(settleX402Payment("BAD")).rejects.toThrow("timeout");
  });
});
