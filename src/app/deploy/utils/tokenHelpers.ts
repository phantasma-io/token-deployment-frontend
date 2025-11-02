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
