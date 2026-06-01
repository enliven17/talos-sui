import { NextRequest } from "next/server";
import { addressFromJwt, fetchZkProof } from "@/lib/zklogin";

/**
 * POST /api/zklogin/finish
 *
 * Body: {
 *   jwt: string,                       // returned by Google/Twitch
 *   extendedEphemeralPublicKey: string,
 *   maxEpoch: number,
 *   jwtRandomness: string,
 *   salt: string,                      // optional, defaults to dev fallback
 * }
 *
 * Returns the Sui address + the zkLoginInputs blob the client uses to
 * sign Sui transactions in lieu of a wallet keypair.
 */
export const dynamic = "force-dynamic";

interface FinishBody {
  jwt?: string;
  extendedEphemeralPublicKey?: string;
  maxEpoch?: number;
  jwtRandomness?: string;
  salt?: string;
}

export async function POST(request: NextRequest) {
  let body: FinishBody;
  try {
    body = (await request.json()) as FinishBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const {
    jwt,
    extendedEphemeralPublicKey,
    maxEpoch,
    jwtRandomness,
    salt,
  } = body;
  if (!jwt || !extendedEphemeralPublicKey || maxEpoch == null || !jwtRandomness) {
    return Response.json(
      { error: "jwt, extendedEphemeralPublicKey, maxEpoch, jwtRandomness are required" },
      { status: 400 },
    );
  }

  const userSalt = salt ?? "129390038138390";
  const address = addressFromJwt(jwt, BigInt(userSalt));

  try {
    const inputs = await fetchZkProof({
      jwt,
      extendedEphemeralPublicKey,
      maxEpoch,
      jwtRandomness,
      salt: userSalt,
    });
    return Response.json({ address, inputs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Proof generation failed: ${msg}`, address },
      { status: 502 },
    );
  }
}
