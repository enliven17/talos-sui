import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { regenerateKeySchema, parseBody } from "@/lib/schemas";

// POST /api/talos/:id/regenerate-key — Regenerate API key (invalidates old key)
// Requires a Sui Ed25519 personalMessage signature proving wallet ownership.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const parsed = await parseBody(request, regenerateKeySchema);
    if (parsed.error) return parsed.error;

    const { suiAddress, signature, message } = parsed.data;

    // Verify the message contains the TALOS ID to prevent replay across TALOSes
    if (!message.includes(id)) {
      return Response.json(
        { error: "Signature message must contain the TALOS ID" },
        { status: 400 }
      );
    }

    const talos = await db.query.tlsTalos.findFirst({
      where: eq(tlsTalos.id, id),
    });

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    // Only the creator wallet can regenerate
    if (
      talos.walletAddress !== suiAddress &&
      talos.creatorAddress !== suiAddress
    ) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Verify Sui signature using the @mysten/sui cryptography helpers.
    try {
      const { verifyPersonalMessageSignature } = await import("@mysten/sui/verify");
      const messageBytes = new TextEncoder().encode(message);
      const recovered = await verifyPersonalMessageSignature(messageBytes, signature);
      const recoveredAddr = recovered.toSuiAddress();
      if (recoveredAddr.toLowerCase() !== suiAddress.toLowerCase()) {
        return Response.json({ error: "Signature does not match address" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Invalid signature" }, { status: 403 });
    }

    const newApiKey = `tak_${randomBytes(24).toString("hex")}`;

    await db
      .update(tlsTalos)
      .set({ apiKey: newApiKey })
      .where(eq(tlsTalos.id, id));

    return Response.json({ apiKey: newApiKey });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
