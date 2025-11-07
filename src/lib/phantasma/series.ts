import {
  Bytes32,
  CreateSeriesFeeOptions,
  CreateTokenSeriesTxHelper,
  EasyConnect,
  CursorPaginatedResult,
  MetadataField,
  TokenSeriesResult,
  SeriesInfo,
  SeriesInfoBuilder,
  TransactionData,
  VmStructSchema,
  VmType,
  getRandomPhantasmaId,
} from "phantasma-sdk-ts";

import { ensureError, toMessage } from "./errors";
import { createApi } from "./api";
import { waitForTransactionConfirmation } from "./tx";
import { extractPublicKeyBytes, isWalletSignResult } from "./wallet";
import { parseHexBytes, parseVmMetadataValue } from "./metadata";

export type TokenSeriesListItem = {
  carbonTokenId: bigint;
  carbonSeriesId: number;
  seriesId: string;
  metadata: Record<string, string>;
};

const MAX_SERIES_PAGE_LOOPS = 10;

export async function listTokenSeries(
  symbol: string,
  carbonTokenId: bigint | number,
  pageSize: number = 50,
): Promise<TokenSeriesListItem[]> {
  if ((!symbol || !symbol.trim()) && (carbonTokenId === undefined || carbonTokenId === null)) {
    throw new Error("symbol or carbonTokenId is required");
  }

  const api = createApi();
  const normalizedTokenId = BigInt(carbonTokenId);
  const collected: TokenSeriesListItem[] = [];

  let cursor = "";
  let loops = 0;

  try {
    while (true) {
      const page: CursorPaginatedResult<TokenSeriesResult | TokenSeriesResult[]> = await api.getTokenSeries(
        symbol,
        normalizedTokenId,
        pageSize,
        cursor,
      );
      const payload = page?.result;
      const items: TokenSeriesResult[] = Array.isArray(payload)
        ? payload
        : payload
          ? [payload]
          : [];

      for (const entry of items) {
        const meta: Record<string, string> = {};
        if (Array.isArray(entry.metadata)) {
          for (const prop of entry.metadata) {
            if (prop?.key) {
              meta[String(prop.key)] = String(prop.value ?? "");
            }
          }
        }
        let tokenIdForEntry = normalizedTokenId;
        if (entry?.carbonTokenId) {
          try {
            tokenIdForEntry = BigInt(entry.carbonTokenId);
          } catch {
            tokenIdForEntry = normalizedTokenId;
          }
        }
        collected.push({
          carbonTokenId: tokenIdForEntry,
          carbonSeriesId: entry.carbonSeriesId,
          seriesId: entry.seriesId,
          metadata: meta,
        });
      }

      if (!page?.cursor) {
        break;
      }
      cursor = page.cursor;
      loops += 1;
      if (loops >= MAX_SERIES_PAGE_LOOPS) {
        break;
      }
    }
  } catch (error: unknown) {
    throw ensureError(error);
  }

  return collected;
}

export type CreateSeriesParams = {
  conn: EasyConnect;
  carbonTokenId: bigint | number;
  seriesSchema: VmStructSchema; // must include default fields (id, mode, rom) and any standard/custom fields
  // All series metadata values keyed by field name (excluding reserved _i/mode/rom)
  seriesValues: Record<string, string>;
  romHex?: string; // hex string for shared ROM (use "0x" or empty for none)
  feeOptions?: CreateSeriesFeeOptions;
  maxData?: bigint;
  expiry?: bigint | number | null;
  addLog?: (message: string, data?: unknown) => void;
};

export type CreateSeriesResult =
  | { success: true; txHash: string; seriesId?: number; result?: unknown }
  | { success: false; error: string };

export async function createSeries(params: CreateSeriesParams): Promise<CreateSeriesResult> {
  const {
    conn,
    carbonTokenId,
    seriesSchema,
    seriesValues,
    romHex,
    feeOptions,
    maxData,
    expiry,
  } = params;

  if (!conn) {
    return { success: false, error: "Wallet connection (conn) is required" };
  }
  if (carbonTokenId === undefined || carbonTokenId === null) {
    return { success: false, error: "carbonTokenId is required" };
  }
  if (!seriesSchema) {
    return { success: false, error: "seriesSchema is required" };
  }

  // Prepare creator public key
  const publicKeyBytes = extractPublicKeyBytes(conn);
  const creatorPk = new Bytes32(publicKeyBytes);

  // Parse ROM hex (supports with or without 0x prefix)
  let romBytes: Uint8Array;
  try {
    romBytes = parseHexBytes(romHex ?? "", "rom");
  } catch (err: unknown) {
    return { success: false, error: `Invalid ROM hex: ${toMessage(err)}` };
  }

  // Build series info
  let seriesInfo: SeriesInfo;
  try {
    const phantasmaSeriesId = await getRandomPhantasmaId();
    // Build MetadataField[] for SDK builder. 'rom' must be Uint8Array (VmType.Bytes).
    const metadataList: MetadataField[] = [];

    // Include ROM only when non-empty, as per SDK expectations.
    if (romBytes && romBytes.length > 0) {
      metadataList.push({ name: 'rom', value: romBytes });
    }

    // Map schema fields to typed values from seriesValues
    const fields = seriesSchema?.fields ?? [];
    for (const f of fields) {
      const key = String(f?.name?.data ?? "");
      if (!key || key === "_i" || key === "mode" || key === "rom") continue;
      const vmType = f.schema?.type as VmType;
      try {
        const parsedValue = parseVmMetadataValue(vmType, (seriesValues[key] ?? "").trim(), key);
        metadataList.push({ name: key, value: parsedValue });
      } catch (err: unknown) {
        return { success: false, error: toMessage(err) };
      }
    }

    // Use SDK builder for SeriesInfo (avoids local duplication)
    seriesInfo = SeriesInfoBuilder.build(
      seriesSchema,
      phantasmaSeriesId,
      0,
      0,
      creatorPk,
      metadataList,
    );
  } catch (err: unknown) {
    return { success: false, error: `Failed to build SeriesInfo: ${toMessage(err)}` };
  }

  // Build tx
  const expiryValue: bigint | undefined =
    expiry !== undefined && expiry !== null ? BigInt(expiry as number | bigint) : undefined;

  let txMsg;
  try {
    txMsg = CreateTokenSeriesTxHelper.buildTx(
      BigInt(carbonTokenId as number | bigint),
      seriesInfo,
      creatorPk,
      feeOptions,
      maxData,
      expiryValue,
    );
  } catch (err: unknown) {
    return { success: false, error: `Failed to build series tx: ${toMessage(err)}` };
  }

  // Ask wallet to sign + broadcast
  let walletResult: { hash: string; id: number; success: boolean };
  try {
    walletResult = await new Promise<{ hash: string; id: number; success: boolean }>((resolve, reject) => {
      try {
        conn.signCarbonTransaction(
          txMsg,
          (res: unknown) => {
            if (!isWalletSignResult(res)) {
              reject(new Error("Unexpected wallet response"));
              return;
            }
            if (res.success === false) {
              reject(new Error(res.error || "Wallet rejected transaction"));
              return;
            }
            resolve({ hash: res.hash, id: res.id, success: true });
          },
          (err: unknown) => {
            reject(ensureError(err));
          },
        );
      } catch (inner) {
        reject(ensureError(inner));
      }
    });
  } catch (err: unknown) {
    return { success: false, error: toMessage(err) || "Wallet rejected transaction" };
  }

  const txHash = walletResult.hash;
  let seriesId: number | undefined = undefined;

  if (txHash) {
    const api = createApi();
    const confirmation = await waitForTransactionConfirmation(api, txHash, {
      maxAttempts: 30,
      delayMs: 1000,
      failureDetailAttempts: 6,
    });

    if (confirmation.status === "success") {
      const txInfo = (confirmation as { status: "success"; tx: TransactionData }).tx;
      if (typeof txInfo?.result === "string") {
        try {
          seriesId = CreateTokenSeriesTxHelper.parseResult(txInfo?.result);
        } catch {
          seriesId = undefined;
        }
      }
    } else if (confirmation.status === "failure") {
      const failure = confirmation as { status: "failure"; tx: TransactionData; message?: string };
      const message = failure.message
        ? `${failure.message}`
        : "Transaction execution failed";
      return { success: false, error: `Transaction ${txHash} failed: ${message}` };
    } else {
      return { success: false, error: `Transaction ${txHash} confirmation timed out` };
    }
  }

  return { success: true, txHash: txHash || "pending", seriesId, result: walletResult };
}
