import { NextRequest } from "next/server";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getSuiClient, keypairFromSecret } from "@/lib/sui";

/**
 * POST /api/sponsor
 *
 * Sui Sponsored Transactions. The user (sender) builds a transaction
 * client-side without specifying gas, sends it here as base64, the
 * operator picks one of its gas coins and co-signs as the gas payer.
 *
 * This lets new users do their Genesis without owning SUI — onboarding
 * for the next billion agents.
 *
 * Body:
 *   { txKindBase64: string, sender: string, gasBudget?: number }
 *
 * Response:
 *   { txBytesBase64, sponsorSignature, gasCoin, sponsor }
 *
 * The client then attaches its own signature, calls
 * `client.executeTransaction` with `[sponsorSignature, senderSignature]`,
 * and the operator pays the gas.
 *
 * Spec: https://docs.sui.io/concepts/transactions/sponsored-transactions
 */
export const dynamic = "force-dynamic";

interface SponsorRequest {
  txKindBase64?: string;
  sender?: string;
  gasBudget?: number;
}

export async function POST(request: NextRequest) {
  const operatorSecret = process.env.SUI_OPERATOR_SECRET_KEY;
  if (!operatorSecret) {
    return Response.json(
      { error: "Sponsor unavailable: SUI_OPERATOR_SECRET_KEY not set" },
      { status: 503 },
    );
  }

  let body: SponsorRequest;
  try {
    body = (await request.json()) as SponsorRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { txKindBase64, sender } = body;
  const gasBudget = body.gasBudget ?? 50_000_000; // 0.05 SUI default

  if (!txKindBase64 || !sender) {
    return Response.json(
      { error: "txKindBase64 and sender are required" },
      { status: 400 },
    );
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(sender)) {
    return Response.json({ error: "Invalid sender address" }, { status: 400 });
  }

  try {
    const client = getSuiClient();
    const sponsor: Ed25519Keypair = keypairFromSecret(operatorSecret);
    const sponsorAddress = sponsor.getPublicKey().toSuiAddress();

    // Find a gas coin the operator owns
    const coins = await client.getCoins({
      owner: sponsorAddress,
      coinType: "0x2::sui::SUI",
      limit: 5,
    });
    const gasCoin = coins.data.find((c) => BigInt(c.balance) >= BigInt(gasBudget));
    if (!gasCoin) {
      return Response.json(
        {
          error: "Operator has no SUI coin big enough for the requested gasBudget",
          gasBudget,
        },
        { status: 503 },
      );
    }

    // Reconstruct the TransactionKind from base64 and wrap it in a full
    // Transaction with operator-paid gas.
    const txKindBytes = fromBase64(txKindBase64);
    const tx = Transaction.fromKind(txKindBytes);
    tx.setSender(sender);
    tx.setGasOwner(sponsorAddress);
    tx.setGasPayment([
      {
        objectId: gasCoin.coinObjectId,
        version: gasCoin.version,
        digest: gasCoin.digest,
      },
    ]);
    tx.setGasBudget(gasBudget);

    const builtBytes = await tx.build({ client });
    const sponsorSignature = await sponsor.signTransaction(builtBytes);

    return Response.json({
      txBytesBase64: toBase64(builtBytes),
      sponsorSignature: sponsorSignature.signature,
      sponsor: sponsorAddress,
      gasCoin: gasCoin.coinObjectId,
      gasBudget,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sponsor]", msg);
    return Response.json({ error: `Sponsor failed: ${msg}` }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    description:
      "POST { txKindBase64, sender, gasBudget? } to get an operator-co-signed sponsored Sui transaction. The caller adds their own signature and submits.",
    docs: "https://docs.sui.io/concepts/transactions/sponsored-transactions",
  });
}
