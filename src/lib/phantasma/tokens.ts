import type { Token } from "phantasma-sdk-ts";
import { createApi } from "./api";
import { ensureError } from "./errors";

export async function getTokens(ownerAddress: string): Promise<Token[]> {
  if (!ownerAddress) {
    return [];
  }

  const api = createApi();
  try {
    return await api.getTokens(ownerAddress, true);
  } catch (error: unknown) {
    throw ensureError(error);
  }
}

export async function getTokenExtended(symbol: string): Promise<Token> {
  if (!symbol || !symbol.trim()) {
    throw new Error("symbol is required");
  }
  const api = createApi();
  try {
    // PhantasmaAPI.getToken(symbol, extended, carbonTokenId)
    return await api.getToken(symbol, true, 0n);
  } catch (error: unknown) {
    throw ensureError(error);
  }
}

