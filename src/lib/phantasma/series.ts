import {
  Bytes32,
  CreateSeriesFeeOptions,
  CreateTokenSeriesTxHelper,
  EasyConnect,
  SeriesInfo,
  SeriesInfoBuilder,
  TransactionData,
  VmStructSchema,
  VmType,
  getRandomPhantasmaId,
  hexToBytes,
  MetadataField,
} from "phantasma-sdk-ts";

import { ensureError, toMessage } from "./errors";
import { createApi } from "./api";
import { waitForTransactionConfirmation } from "./tx";
import { extractPublicKeyBytes } from "./wallet";

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
  let romBytes: Uint8Array | undefined = undefined;
  try {
    const hex = (romHex || "").trim();
    if (hex.length > 0) {
      const normalized = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
      if (normalized.length === 0) {
        romBytes = new Uint8Array();
      } else {
        if (!/^[0-9a-fA-F]+$/.test(normalized)) {
          return { success: false, error: "ROM value must be a hex string" };
        }
        if (normalized.length % 2 !== 0) {
          return { success: false, error: "ROM hex length must be even" };
        }
        romBytes = hexToBytes(normalized);
      }
    } else {
      romBytes = new Uint8Array();
    }
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
      const key = String(f?.name?.data ?? '');
      if (!key || key === '_i' || key === 'mode' || key === 'rom') continue;
      const t = f.schema?.type as number; // VmType at runtime
      const raw = seriesValues[key] ?? '';

      let val: string | number | Uint8Array | bigint;
      if (t === VmType.String) {
        val = raw;
      } else if (
        t === VmType.Int8 ||
        t === VmType.Int16 ||
        t === VmType.Int32
      ) {
        if (!/^[-]?\d+$/.test(raw.trim())) {
          return { success: false, error: `Invalid integer for '${key}'` };
        }
        val = Number.parseInt(raw.trim(), 10);
      } else if (
        t === VmType.Int64 ||
        t === VmType.Int256
      ) {
        if (!/^[-]?\d+$/.test(raw.trim())) {
          return { success: false, error: `Invalid bigint for '${key}'` };
        }
        val = BigInt(raw.trim());
      } else if (
        t === VmType.Bytes ||
        t === VmType.Bytes16 ||
        t === VmType.Bytes32 ||
        t === VmType.Bytes64
      ) {
        const s = raw.trim();
        const normalized = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
        if (normalized.length % 2 !== 0 || (normalized.length > 0 && !/^[0-9a-fA-F]+$/.test(normalized))) {
          return { success: false, error: `Invalid hex for '${key}'` };
        }
        val = normalized.length > 0 ? hexToBytes(normalized) : new Uint8Array();
      } else {
        // Default to string if type is not explicitly handled (SDK will validate)
        val = raw;
      }

      metadataList.push({ name: key, value: val });
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

function isWalletSignResult(x: unknown): x is { hash: string; id: number; success: boolean; error?: string } {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return typeof v.hash === "string" && typeof v.id === "number" && typeof v.success === "boolean";
}

