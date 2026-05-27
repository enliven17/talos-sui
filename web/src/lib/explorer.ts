/**
 * Block explorer URL builders.
 *
 * `NEXT_PUBLIC_SUI_NETWORK` flips the network segment in the URL so
 * mainnet-deployed instances don't accidentally link to testnet pages and
 * vice versa. Falls back to testnet.
 */

const NETWORK =
  (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
    | "mainnet"
    | "testnet"
    | "devnet";

const SUISCAN_BASE = `https://suiscan.xyz/${NETWORK}`;
const SUIVISION_BASE =
  NETWORK === "mainnet"
    ? "https://suivision.xyz"
    : `https://${NETWORK}.suivision.xyz`;

export function suiscanAddressUrl(address: string): string {
  return `${SUISCAN_BASE}/account/${address}`;
}

export function suiscanObjectUrl(objectId: string): string {
  return `${SUISCAN_BASE}/object/${objectId}`;
}

export function suiscanTxUrl(digest: string): string {
  return `${SUISCAN_BASE}/tx/${digest}`;
}

export function suiscanPackageUrl(packageId: string): string {
  return `${SUISCAN_BASE}/package/${packageId}`;
}

export function suivisionObjectUrl(objectId: string): string {
  return `${SUIVISION_BASE}/object/${objectId}`;
}

export function suivisionTxUrl(digest: string): string {
  return `${SUIVISION_BASE}/txblock/${digest}`;
}

export const suiExplorerNetwork = NETWORK;
