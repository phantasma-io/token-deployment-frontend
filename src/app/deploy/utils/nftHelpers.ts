import type { NFT } from "phantasma-sdk-ts";

export function getNftId(nft: NFT | null | undefined): string {
  if (!nft) return "";
  const candidate = (nft as unknown as Record<string, unknown>).id;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof nft.ID === "string" && nft.ID.trim().length > 0) {
    return nft.ID.trim();
  }
  return "";
}

export function truncateMiddle(value: string, maxLength: number, tailLength: number = Math.min(6, Math.floor(maxLength / 4))): string {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  const tail = Math.max(1, Math.min(tailLength, maxLength - 1));
  const head = Math.max(1, maxLength - tail - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatNftIdForDisplay(nft: NFT | null | undefined, maxLength: number): string {
  const id = getNftId(nft);
  if (!id) return "";
  return truncateMiddle(id, maxLength);
}
