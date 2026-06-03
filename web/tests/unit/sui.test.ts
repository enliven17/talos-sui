import { describe, it, expect } from "vitest";
import {
  usdcToMicros,
  microsToUsdc,
  isValidSuiAddress,
  USDC_DECIMALS,
} from "@/lib/sui";

describe("USDC_DECIMALS", () => {
  it("is 6", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});

describe("usdcToMicros", () => {
  it("converts '0' to 0n", () => {
    expect(usdcToMicros("0")).toBe(0n);
  });

  it("converts '0.1' to 100_000n", () => {
    expect(usdcToMicros("0.1")).toBe(100_000n);
  });

  it("converts '0.000001' to 1n", () => {
    expect(usdcToMicros("0.000001")).toBe(1n);
  });

  it("converts '1' to 1_000_000n", () => {
    expect(usdcToMicros("1")).toBe(1_000_000n);
  });

  it("converts '1.5' to 1_500_000n", () => {
    expect(usdcToMicros("1.5")).toBe(1_500_000n);
  });

  it("converts '1000000.123456' to 1_000_000_123_456n", () => {
    expect(usdcToMicros("1000000.123456")).toBe(1_000_000_123_456n);
  });

  it("accepts numeric input", () => {
    expect(usdcToMicros(1)).toBe(1_000_000n);
    expect(usdcToMicros(0.5)).toBe(500_000n);
  });

  it("truncates fractions beyond 6 decimals", () => {
    expect(usdcToMicros("0.1234567")).toBe(123_456n);
  });

  it("trims whitespace", () => {
    expect(usdcToMicros("  2.5  ")).toBe(2_500_000n);
  });

  it("handles bare decimal '.5' as 500_000n", () => {
    // whole side becomes "" -> 0, frac "5" -> "500000"
    expect(usdcToMicros(".5")).toBe(500_000n);
  });
});

describe("microsToUsdc", () => {
  it("converts 0n to '0'", () => {
    expect(microsToUsdc(0n)).toBe("0");
  });

  it("converts 100_000n to '0.1'", () => {
    expect(microsToUsdc(100_000n)).toBe("0.1");
  });

  it("converts 1n to '0.000001'", () => {
    expect(microsToUsdc(1n)).toBe("0.000001");
  });

  it("converts 1_000_000n to '1'", () => {
    expect(microsToUsdc(1_000_000n)).toBe("1");
  });

  it("converts 1_500_000n to '1.5'", () => {
    expect(microsToUsdc(1_500_000n)).toBe("1.5");
  });

  it("converts 1_000_000_123_456n to '1000000.123456'", () => {
    expect(microsToUsdc(1_000_000_123_456n)).toBe("1000000.123456");
  });

  it("accepts string and number inputs", () => {
    expect(microsToUsdc("1000000")).toBe("1");
    expect(microsToUsdc(1_500_000)).toBe("1.5");
  });
});

describe("usdcToMicros <-> microsToUsdc round-trip", () => {
  const cases = ["0", "0.1", "0.000001", "1", "1.5", "1000000.123456"];

  for (const c of cases) {
    it(`round-trips '${c}'`, () => {
      const micros = usdcToMicros(c);
      const back = microsToUsdc(micros);
      expect(back).toBe(c);
    });
  }
});

describe("isValidSuiAddress", () => {
  it("accepts full 64-hex address", () => {
    const addr =
      "0x" + "a".repeat(64);
    expect(isValidSuiAddress(addr)).toBe(true);
  });

  it("accepts shorter hex (regex allows 1-64 hex)", () => {
    expect(isValidSuiAddress("0xabc")).toBe(true);
    expect(isValidSuiAddress("0x1")).toBe(true);
  });

  it("accepts mixed-case hex", () => {
    expect(
      isValidSuiAddress("0xAbCdEf1234567890" + "0".repeat(48)),
    ).toBe(true);
  });

  it("rejects missing 0x prefix", () => {
    expect(isValidSuiAddress("a".repeat(64))).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidSuiAddress("")).toBe(false);
  });

  it("rejects too-long (65 hex chars)", () => {
    expect(isValidSuiAddress("0x" + "a".repeat(65))).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidSuiAddress("0xZZZZ")).toBe(false);
    expect(isValidSuiAddress("0xg" + "a".repeat(63))).toBe(false);
  });

  it("rejects 0x with nothing after", () => {
    expect(isValidSuiAddress("0x")).toBe(false);
  });

  it("rejects uppercase 0X prefix", () => {
    expect(isValidSuiAddress("0X" + "a".repeat(64))).toBe(false);
  });
});
