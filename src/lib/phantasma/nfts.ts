import { CursorPaginatedResult, NFT } from "phantasma-sdk-ts";

import { createApi } from "./api";
import { ensureError } from "./errors";

export type ListTokenNftsParams = {
  carbonTokenId: bigint | number;
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
      BigInt(carbonTokenId),
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
