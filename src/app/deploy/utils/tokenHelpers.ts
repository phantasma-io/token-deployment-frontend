import type { Token } from "phantasma-sdk-ts";

export function getTokenPrimary(token: Token | undefined, fallback: string) {
  const sym = token?.symbol;
  return String(sym ?? fallback);
}

export function extractTokenFlagList(token?: Token) {
  if (token?.flags && typeof token.flags === "string") {
    return token.flags
      .split(",")
      .map((flag) => flag.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

export function isTokenNFT(token?: Token) {
  const flags = extractTokenFlagList(token);
  return !flags.includes("fungible");
}

export function getTokenMetadataMap(token?: Token): Record<string, string> {
  const metadata = (token as Token & {
    metadata?: Array<{ key?: string | null; value?: string | null }>;
  })?.metadata;
  const map: Record<string, string> = {};
  if (!Array.isArray(metadata)) {
    return map;
  }
  for (const entry of metadata) {
    const key = entry?.key?.trim();
    if (!key) continue;
    map[key] = entry?.value ?? "";
  }
  return map;
}

const DATA_URI_REGEX = /^data:/i;

export function getTokenIconSrc(
  token?: Token,
  metadataMap?: Record<string, string>,
): string | null {
  const metadata = metadataMap ?? getTokenMetadataMap(token);
  const raw = metadata.icon?.trim();
  if (!raw) return null;
  if (!DATA_URI_REGEX.test(raw)) {
    return null;
  }
  return raw;
}
