/**
 * zkLogin helpers — sign Sui transactions with a Google / Twitch JWT.
 *
 * zkLogin lets a user prove "I own this Sui address" purely from an
 * OAuth provider's JWT plus a zero-knowledge proof. No browser wallet,
 * no recovery phrase — perfect for onboarding the next billion agents.
 *
 * Mysten ships an official prover service; we wrap the address-derivation
 * and proof-fetching here so the rest of the codebase doesn't import the
 * crypto APIs directly.
 *
 * Spec: https://docs.sui.io/concepts/cryptography/zklogin
 */
import { generateNonce, generateRandomness, jwtToAddress } from "@mysten/sui/zklogin";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

/** Default prover service — Mysten-hosted, free for testnet. */
const ZK_PROVER_URL =
  process.env.SUI_ZK_PROVER_URL ??
  process.env.NEXT_PUBLIC_SUI_ZK_PROVER_URL ??
  "https://prover-dev.mystenlabs.com/v1";

/** Salt — in prod this should be persisted per-user. */
const ZK_SALT_FALLBACK = BigInt("129390038138390"); // dev-only

/**
 * Bootstrap the ephemeral keypair + nonce we'll send to the OAuth
 * provider as the `nonce` claim. After the redirect we use the returned
 * JWT to (1) derive the Sui address and (2) fetch a ZK proof.
 */
export function zkLoginStart() {
  const ephemeral = Ed25519Keypair.generate();
  const randomness = generateRandomness();
  const maxEpoch = 100; // arbitrary, must be > current epoch when proving
  const nonce = generateNonce(
    ephemeral.getPublicKey(),
    maxEpoch,
    randomness,
  );
  return {
    nonce,
    randomness,
    maxEpoch,
    ephemeralSecretKey: ephemeral.getSecretKey(),
  };
}

/**
 * Derive the user's deterministic Sui address from their JWT.
 * Same JWT + same salt → same address forever.
 */
export function addressFromJwt(jwt: string, userSalt: bigint = ZK_SALT_FALLBACK): string {
  return jwtToAddress(jwt, userSalt);
}

/**
 * Call the Mysten prover service to mint a ZK proof for a particular
 * JWT + ephemeral key + max epoch combination. Returns the
 * `zkLoginInputs` blob you then pass to the transaction signer.
 */
export async function fetchZkProof(args: {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName?: string;
}): Promise<unknown> {
  const res = await fetch(ZK_PROVER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...args,
      keyClaimName: args.keyClaimName ?? "sub",
    }),
  });
  if (!res.ok) {
    throw new Error(`zkLogin proof failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

export const ZK_LOGIN_PROVER_URL = ZK_PROVER_URL;
