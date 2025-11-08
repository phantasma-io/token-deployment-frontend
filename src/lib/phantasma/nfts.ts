import { CursorPaginatedResult, NFT, Token, TokenSeriesResult } from "phantasma-sdk-ts";

import { createApi } from "./api";
import { ensureError } from "./errors";
import { mapTokenSeriesResult, type TokenSeriesListItem } from "./series";

export type ListTokenNftsParams = {
  carbonTokenId: bigint;
  carbonSeriesId?: number;
  pageSize?: number;
  cursor?: string;
  extended?: boolean;
};

export type ListTokenNftsResult = {
  items: NFT[];
  nextCursor: string | null;
};

export async function listTokenNfts(params: ListTokenNftsParams): Promise<ListTokenNftsResult> {
  const {
    carbonTokenId,
    carbonSeriesId = 0,
    pageSize = 10,
    cursor = "",
    extended = true,
  } = params;

  if (carbonTokenId === undefined || carbonTokenId === null) {
    throw new Error("carbonTokenId is required");
  }

  const api = createApi();
  try {
    const response: CursorPaginatedResult<NFT[]> = await api.getTokenNFTs(
      carbonTokenId,
      Number(carbonSeriesId),
      pageSize,
      cursor,
      extended,
    );

    const payload = response?.result;
    const items: NFT[] = Array.isArray(payload)
      ? payload
      : payload
        ? [payload]
        : [];

    return {
      items,
      nextCursor: response?.cursor ?? null,
    };
  } catch (err: unknown) {
    throw ensureError(err);
  }
}

export type ListAccountOwnedTokensParams = {
  account: string;
  pageSize?: number;
  cursor?: string;
  checkAddressReservedByte?: boolean;
};

export type ListAccountOwnedTokensResult = {
  items: Token[];
  nextCursor: string | null;
};

export async function listAccountOwnedTokens(params: ListAccountOwnedTokensParams): Promise<ListAccountOwnedTokensResult> {
  const { account, pageSize = 50, cursor = "", checkAddressReservedByte = true } = params;
  if (!account?.trim()) {
    throw new Error("account is required");
  }

  const api = createApi();
  try {
    const response: CursorPaginatedResult<Token[]> = await api.getAccountOwnedTokens(
      account,
      "",
      0n,
      pageSize,
      cursor,
      checkAddressReservedByte,
    );
    const payload = response?.result;
    const items: Token[] = Array.isArray(payload)
      ? payload
      : payload
        ? [payload]
        : [];
    return { items, nextCursor: response?.cursor ?? null };
  } catch (err: unknown) {
    throw ensureError(err);
  }
}

export type ListAccountOwnedSeriesParams = {
  account: string;
  tokenSymbol?: string;
  carbonTokenId?: bigint;
  pageSize?: number;
  cursor?: string;
  checkAddressReservedByte?: boolean;
};

export type ListAccountOwnedSeriesResult = {
  items: TokenSeriesListItem[];
  nextCursor: string | null;
};

export async function listAccountOwnedSeries(params: ListAccountOwnedSeriesParams): Promise<ListAccountOwnedSeriesResult> {
  const {
    account,
    carbonTokenId = 0n,
    pageSize = 50,
    cursor = "",
    checkAddressReservedByte = true,
  } = params;

  if (!account?.trim()) {
    throw new Error("account is required");
  }

  const api = createApi();
  try {
    const response = await api.getAccountOwnedTokenSeries(
      account,
      "",
      carbonTokenId,
      pageSize,
      cursor,
      checkAddressReservedByte,
    );
    const payload = response?.result;
    const itemsRaw: TokenSeriesResult[] = Array.isArray(payload)
      ? payload
      : payload
        ? [payload]
        : [];
    const mapped: TokenSeriesListItem[] = [];
    for (const entry of itemsRaw) {
      const item = mapTokenSeriesResult(entry, carbonTokenId);
      if (item) mapped.push(item);
    }
    return { items: mapped, nextCursor: response?.cursor ?? null };
  } catch (err: unknown) {
    throw ensureError(err);
  }
}

export type ListAccountNftsParams = {
  account: string;
  tokenSymbol?: string;
  carbonTokenId?: bigint;
  carbonSeriesId?: number;
  pageSize?: number;
  cursor?: string;
  extended?: boolean;
  checkAddressReservedByte?: boolean;
};

export async function listAccountNfts(params: ListAccountNftsParams): Promise<ListTokenNftsResult> {
  const {
    account,
    tokenSymbol = "",
    carbonTokenId = 0n,
    carbonSeriesId = 0,
    pageSize = 10,
    cursor = "",
    extended = true,
    checkAddressReservedByte = true,
  } = params;

  if (!account?.trim()) {
    throw new Error("account is required");
  }

  const api = createApi();
  try {
    const response: CursorPaginatedResult<NFT[]> = await api.getAccountNFTs(
      account,
      "",
      carbonTokenId,
      carbonSeriesId,
      pageSize,
      cursor,
      extended,
      checkAddressReservedByte,
    );
    const payload = response?.result;
    const items: NFT[] = Array.isArray(payload)
      ? payload
      : payload
        ? [payload]
        : [];
    return { items, nextCursor: response?.cursor ?? null };
  } catch (err: unknown) {
    throw ensureError(err);
  }
}
