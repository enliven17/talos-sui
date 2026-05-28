/**
 * x402-on-Sui — HTTP-402 micro-payments using Sui USDC transfers.
 *
 * There is no canonical x402 Sui facilitator yet, so we implement the
 * minimal pattern ourselves:
 *
 *   1. Buyer hits the service URL.
 *   2. Server responds 402 with `{ to, amount, assetType }`.
 *   3. Buyer executes a Sui USDC transfer of `amount` to `to` and replays
 *      the request with header `X-Payment: sui-tx <digest>`.
 *   4. Server reads the on-chain tx via Tatum-backed SuiClient,
 *      verifies sender / recipient / amount / coin type, then settles.
 *
 * This keeps the same API surface used elsewhere in the codebase
 * (`signX402Payment`, `verifyX402Payment`, `settleX402Payment`,
 * `buildX402Header`) while running entirely on Sui.
 */
import { Transaction } from "@mysten/sui/transactions";
import {
  getSuiClient,
  getUsdcType,
  keypairFromSecret,
  usdcToMicros,
} from "./sui";

export interface SuiX402Payload {
  /** Sui address of the payer (the agent's wallet). */
  from: string;
  /** Sui address of the payee (service provider). */
  to: string;
  /** Amount in human-readable USDC (e.g. "1.00"). */
  amount: string;
  /** Coin type — defaults to USDC for the active network. */
  coinType?: string;
}

/**
 * Sign and submit a USDC payment, returning the transaction digest which
 * acts as the "payment token" the buyer hands to the seller.
 *
 * On Sui we submit the payment immediately and pass the resulting tx
 * digest as the "payment token". The seller verifies the digest is a
 * confirmed USDC transfer with the expected recipient and amount.
 */
export async function signX402Payment(
  agentSecretKey: string,
  payload: SuiX402Payload,
): Promise<{ paymentToken: string; txHash: string }> {
  const client = getSuiClient();
  const keypair = keypairFromSecret(agentSecretKey);
  const sender = keypair.getPublicKey().toSuiAddress();
  const coinType = payload.coinType ?? getUsdcType();
  const micros = usdcToMicros(payload.amount);

  // Pick USDC coins owned by sender
  const coins = await client.getCoins({
    owner: sender,
    coinType,
    limit: 50,
  });
  if (coins.data.length === 0) {
    throw new Error(`No ${coinType} coins on sender ${sender}`);
  }

  const tx = new Transaction();
  const primary = tx.object(coins.data[0]!.coinObjectId);
  if (coins.data.length > 1) {
    tx.mergeCoins(
      primary,
      coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  const [coin] = tx.splitCoins(primary, [tx.pure.u64(micros)]);
  tx.transferObjects([coin!], tx.pure.address(payload.to));

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showBalanceChanges: true },
  });

  return { paymentToken: result.digest, txHash: result.digest };
}

/**
 * Verify a paymentToken (= Sui tx digest) on-chain:
 *   - tx exists & succeeded
 *   - sender is the address we expect (if `expectedFrom` is given)
 *   - a USDC balance change of >= expectedAmount was credited to `expectedTo`
 */
export async function verifyX402Payment(
  paymentToken: string,
  expectedAmount: string,
  expectedTo: string,
  expectedFrom?: string,
): Promise<boolean> {
  try {
    const client = getSuiClient();
    const tx = await client.getTransactionBlock({
      digest: paymentToken,
      options: {
        showEffects: true,
        showBalanceChanges: true,
        showInput: true,
      },
    });
    if (!tx.effects || tx.effects.status?.status !== "success") return false;

    if (expectedFrom) {
      const senderField = (tx.transaction?.data as { sender?: string } | undefined)
        ?.sender;
      if (senderField && senderField.toLowerCase() !== expectedFrom.toLowerCase()) {
        return false;
      }
    }

    const usdcType = getUsdcType();
    const expectedMicros = usdcToMicros(expectedAmount);
    const credited = (tx.balanceChanges ?? []).find((c) => {
      const ownerAddr =
        typeof c.owner === "object" && "AddressOwner" in c.owner
          ? c.owner.AddressOwner
          : null;
      return (
        c.coinType === usdcType &&
        ownerAddr?.toLowerCase() === expectedTo.toLowerCase() &&
        BigInt(c.amount) >= expectedMicros
      );
    });
    return !!credited;
  } catch (err) {
    console.error("[sui-x402] verifyX402Payment failed:", err);
    return false;
  }
}

/**
 * "Settle" on Sui = wait for the transaction to be finalized.
 * The payment is already on-chain by the time we get here.
 */
export async function settleX402Payment(
  paymentToken: string,
): Promise<{ txHash: string }> {
  const client = getSuiClient();
  // Wait briefly for finality on this digest
  await client.waitForTransaction({ digest: paymentToken, timeout: 30_000 });
  return { txHash: paymentToken };
}

/** HTTP header value used by the buyer when replaying the request. */
export function buildX402Header(paymentToken: string): string {
  return `sui-tx ${paymentToken}`;
}

/** Parse an `X-Payment` header into a digest. Returns null if unrecognised. */
export function parseX402Header(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.startsWith("sui-tx ")) return trimmed.slice("sui-tx ".length).trim();
  if (trimmed.startsWith("x402 ")) return trimmed.slice("x402 ".length).trim();
  return trimmed;
}
