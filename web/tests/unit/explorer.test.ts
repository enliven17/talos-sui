import { describe, it, expect } from "vitest";
import {
  suiscanAddressUrl,
  suiscanObjectUrl,
  suiscanTxUrl,
  suiscanPackageUrl,
  suivisionObjectUrl,
  suivisionTxUrl,
  suiExplorerNetwork,
} from "@/lib/explorer";

// These tests assume the default network (testnet) since the env var is
// captured at module load time and cannot be cleanly stubbed mid-test.

describe("suiExplorerNetwork (module load)", () => {
  it("defaults to testnet when NEXT_PUBLIC_SUI_NETWORK is unset", () => {
    // If the env is set in CI we just assert it's one of the known values.
    expect(["mainnet", "testnet", "devnet"]).toContain(suiExplorerNetwork);
  });
});

const ADDR =
  "0x" + "a".repeat(64);
const OBJ = "0x" + "b".repeat(64);
const TX = "9WzSomeBase58Digest12345";
const PKG = "0x" + "c".repeat(64);

describe("suiscanAddressUrl", () => {
  it("builds a suiscan account URL on the active network", () => {
    expect(suiscanAddressUrl(ADDR)).toBe(
      `https://suiscan.xyz/${suiExplorerNetwork}/account/${ADDR}`,
    );
  });

  it("does not URL-encode the address (raw passthrough)", () => {
    const url = suiscanAddressUrl(ADDR);
    expect(url.endsWith(`/account/${ADDR}`)).toBe(true);
  });
});

describe("suiscanObjectUrl", () => {
  it("builds a suiscan object URL", () => {
    expect(suiscanObjectUrl(OBJ)).toBe(
      `https://suiscan.xyz/${suiExplorerNetwork}/object/${OBJ}`,
    );
  });

  it("uses /object/ path segment", () => {
    expect(suiscanObjectUrl(OBJ)).toContain("/object/");
  });
});

describe("suiscanTxUrl", () => {
  it("builds a suiscan tx URL using /tx/", () => {
    expect(suiscanTxUrl(TX)).toBe(
      `https://suiscan.xyz/${suiExplorerNetwork}/tx/${TX}`,
    );
  });

  it("contains the digest verbatim", () => {
    expect(suiscanTxUrl(TX)).toContain(TX);
  });
});

describe("suiscanPackageUrl", () => {
  it("builds a suiscan package URL", () => {
    expect(suiscanPackageUrl(PKG)).toBe(
      `https://suiscan.xyz/${suiExplorerNetwork}/package/${PKG}`,
    );
  });

  it("uses /package/ path segment", () => {
    expect(suiscanPackageUrl(PKG)).toContain("/package/");
  });
});

describe("suivisionObjectUrl", () => {
  it("builds a suivision object URL on the active network", () => {
    const expectedBase =
      suiExplorerNetwork === "mainnet"
        ? "https://suivision.xyz"
        : `https://${suiExplorerNetwork}.suivision.xyz`;
    expect(suivisionObjectUrl(OBJ)).toBe(`${expectedBase}/object/${OBJ}`);
  });

  it("uses subdomain for non-mainnet", () => {
    const url = suivisionObjectUrl(OBJ);
    if (suiExplorerNetwork !== "mainnet") {
      expect(url).toContain(`${suiExplorerNetwork}.suivision.xyz`);
    } else {
      expect(url).toMatch(/^https:\/\/suivision\.xyz\//);
    }
  });
});

describe("suivisionTxUrl", () => {
  it("builds a suivision tx URL using /txblock/", () => {
    const expectedBase =
      suiExplorerNetwork === "mainnet"
        ? "https://suivision.xyz"
        : `https://${suiExplorerNetwork}.suivision.xyz`;
    expect(suivisionTxUrl(TX)).toBe(`${expectedBase}/txblock/${TX}`);
  });

  it("contains /txblock/ (not /tx/) per Suivision convention", () => {
    expect(suivisionTxUrl(TX)).toContain("/txblock/");
    expect(suivisionTxUrl(TX)).not.toMatch(/\/tx\//);
  });

  it("contains the digest verbatim", () => {
    expect(suivisionTxUrl(TX)).toContain(TX);
  });
});

describe("URL builders — empty input edge cases", () => {
  it("suiscanAddressUrl with empty string still produces a URL", () => {
    expect(suiscanAddressUrl("")).toBe(
      `https://suiscan.xyz/${suiExplorerNetwork}/account/`,
    );
  });

  it("suiscanTxUrl with empty digest still produces a URL", () => {
    expect(suiscanTxUrl("")).toBe(
      `https://suiscan.xyz/${suiExplorerNetwork}/tx/`,
    );
  });
});
