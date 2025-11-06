/**
 * phantasmaClient.ts
 *
 * Client-side helpers that talk directly to Phantasma RPC + Link:
 *  - fetch tokens for an owner using PhantasmaAPI.getTokens
 *  - build Carbon create-token transactions locally and forward them to the
 *    connected wallet via EasyConnect.signCarbonTransactionAndBroadcast.
 */

import {
  Address,
  CreateTokenTxHelper,
  TokenInfoBuilder,
  IntX,
  Bytes32,
  TokenInfo as DeploymentTokenInfo,
  Token,
  PhantasmaAPI,
  TokenMetadataBuilder,
  CreateTokenFeeOptions,
  EasyConnect,
  TransactionData,
  TokenSchemasBuilder,
  TokenSchemas,
  // Series creation imports
  CreateSeriesFeeOptions,
  CreateTokenSeriesTxHelper,
  SeriesInfo,
  VmStructSchema,
  VmType,
  getRandomPhantasmaId,
  hexToBytes,
} from "phantasma-sdk-ts";

export type DeployParams = {
  conn: EasyConnect; // wallet connection object (phaCtx.conn)
  ownerAddress: string;
  symbol: string;
  name?: string;
  isNFT: boolean;
  decimals: number;
  maxSupply: bigint;
  metadata?: Record<string, string>;
  tokenSchemasJson?: string; // required for NFTs
  feeOptions?: CreateTokenFeeOptions;
  maxData: bigint;
  expiry?: bigint | number | null;
  addLog?: (message: string, data?: unknown) => void;
};

export type DeployResult =
  | { success: true; txHash: string; tokenId?: number; result?: unknown }
  | { success: false; error: string };

const RPC_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5172/rpc";
const NEXUS = (process.env.NEXT_PUBLIC_PHANTASMA_NEXUS as string) || "testnet";

function createApi() {
  return new PhantasmaAPI(RPC_URL, undefined, NEXUS);
}

/**
 * Fetch tokens for an owner address via server API.
 */
export async function getTokens(ownerAddress: string): Promise<Token[]> {
  console.log("[fetch] getTokens called", { ownerAddress, RPC_URL, NEXUS });

  if (!ownerAddress) {
    console.log("[error] getTokens: No owner address provided");
    return [];
  }

  const api = createApi();

  try {
    const result = await api.getTokens(ownerAddress, true);
    console.log("[rpc] getTokens: RPC response received", {
      type: typeof result,
      isArray: Array.isArray(result),
      length: result?.length,
    });
    return result;
  } catch (error: unknown) {
    console.error("[error] getTokens: RPC call failed", { error });
    throw ensureError(error);
  }
}

/**
 * Fetch a single token by symbol with extended data (schemas, carbon id).
 * Returns the raw RPC object as provided by the node.
 */
// Reuse temporary SDK shims
import { TokenSeriesMetadataBuilder } from "phantasma-sdk-ts";

export async function getTokenExtended(symbol: string): Promise<Token> {
  if (!symbol || !symbol.trim()) {
    throw new Error("symbol is required");
  }
  const api = createApi();
  try {
    // Server updated to TS SDK-compatible signature (symbol, extended)
    return await api.getToken(symbol, true, 0n);
  } catch (error: unknown) {
    console.error("[error] getTokenExtended: RPC call failed", { error });
    throw ensureError(error);
  }
}

/**
 * Deploy carbon token flow:
 * 1) Build the Carbon create-token TxMsg locally via CreateTokenTxHelper.
 * 2) Forward the TxMsg to the connected wallet through signCarbonTransactionAndBroadcast so it
 *    can sign and broadcast.
 * 3) Optionally query the RPC for the transaction result to extract tokenId.
 */
export async function deployCarbonToken(
  params: DeployParams,
): Promise<DeployResult> {
  const {
    conn,
    ownerAddress,
    symbol,
    isNFT = false,
    decimals = 8,
    maxSupply,
    metadata,
    tokenSchemasJson,
    feeOptions,
    maxData,
    expiry,
    addLog,
  } = params;

  if (!conn) {
    return { success: false, error: "Wallet connection (conn) is required" };
  }
  if (!ownerAddress) {
    return { success: false, error: "ownerAddress is required" };
  }
  if (!symbol) {
    return { success: false, error: "symbol is required" };
  }

  const publicKeyBytes = extractPublicKeyBytes(conn);
  const ownerBytes32 = new Bytes32(publicKeyBytes);

  let tokenInfoInstance: DeploymentTokenInfo;
  let tokenSchemas: TokenSchemas | undefined;
  if (isNFT) {
    if (!tokenSchemasJson || !tokenSchemasJson.trim()) {
      return { success: false, error: "Token schemas JSON is required for NFTs" };
    }
    try {
      addLog?.("[schemas] Using TokenSchemas JSON (raw)", { tokenSchemasJson });

      const parsed = JSON.parse(tokenSchemasJson);
      addLog?.("[schemas] Using TokenSchemas", { tokenSchemas: parsed });

      tokenSchemas = TokenSchemasBuilder.fromJson(tokenSchemasJson);
    } catch (err: unknown) {
      return { success: false, error: `Invalid token schemas: ${toMessage(err)}` };
    }
  }

  try {
      tokenInfoInstance = TokenInfoBuilder.build(
        symbol.trim(),
        IntX.fromBigInt(maxSupply),
        isNFT,
        decimals,
        ownerBytes32,
      TokenMetadataBuilder.buildAndSerialize(metadata),
      tokenSchemas,
      );
  } catch {
    return {
      success: false,
      error: "Failed to build TokenInfo struct",
    };
  }

  const expiryValue: bigint | undefined =
    expiry !== undefined && expiry !== null ? BigInt(expiry as number | bigint) : undefined;

  let txMsg;
  try {
    txMsg = CreateTokenTxHelper.buildTx(
      tokenInfoInstance,
      ownerBytes32 ?? tokenInfoInstance.owner ?? new Bytes32(),
      feeOptions,
      maxData,
      expiryValue,
    );
  } catch (err: unknown) {
    return {
      success: false,
      error: `Failed to build Carbon tx: ${toMessage(err)}`,
    };
  }

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
    return {
      success: false,
      error: toMessage(err) || "Wallet rejected transaction",
    };
  }

  console.log("[wallet] walletResult received", walletResult);

  const txHash = walletResult.hash;
  let tokenId: number | undefined = undefined;

    if (txHash) {
    
    const isSuccessOutcome = (o: TransactionWaitOutcome): o is { status: "success"; tx: TransactionData } => o.status === "success";
    const isFailureOutcome = (o: TransactionWaitOutcome): o is { status: "failure"; tx: TransactionData; message?: string } => o.status === "failure";
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
          tokenId = CreateTokenTxHelper.parseResult(txInfo?.result);
        } catch {
          tokenId = undefined;
        }
      }
    } else if (confirmation.status === "failure") {
      const failure = confirmation as { status: "failure"; tx: TransactionData; message?: string };
      const message = failure.message
        ? `${failure.message}`
        : "Transaction execution failed";
      return {
        success: false,
        error: `Transaction ${txHash} failed: ${message}`,
      };
    } else {
      return {
        success: false,
        error: `Transaction ${txHash} confirmation timed out`,
      };
    }
  }

  return {
    success: true,
    txHash: txHash || "pending",
    tokenId,
    result: walletResult,
  };
}

/* ----------------------- helpers ------------------------- */

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPublicKeyBytes(conn: EasyConnect): Uint8Array {
  const addressText = conn?.link?.account?.address;
  if (!addressText || typeof addressText !== "string") {
    throw new Error(
      "Wallet did not expose account address. Reconnect and try again.",
    );
  }

  let addr: Address;
  try {
    addr = Address.FromText(addressText);
  } catch (err) {
    throw new Error(
      `Failed to parse wallet address '${addressText}': ${(err as Error)?.message ?? String(err)
      }`,
    );
  }

  const pkBytes = addr.GetPublicKey() as Uint8Array;
  if (!pkBytes || pkBytes.length !== 32) {
    throw new Error(
      "Wallet did not provide a 32-byte public key. Reconnect and try again.",
    );
  }

  return pkBytes;
}

type TransactionWaitOutcome =
  | { status: "success"; tx: TransactionData }
  | { status: "failure"; tx: TransactionData; message?: string }
  | { status: "timeout" };

async function waitForTransactionConfirmation(
  api: PhantasmaAPI,
  txHash: string,
  opts?: { maxAttempts?: number; delayMs?: number; failureDetailAttempts?: number },
): Promise<TransactionWaitOutcome> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 30);
  const delayMs = Math.max(100, opts?.delayMs ?? 1000);
  const failureDetailMax = Math.max(0, opts?.failureDetailAttempts ?? 6);

  let attempts = 0;
  let failureDetailAttempts = 0;

  while (attempts < maxAttempts) {
    try {
      const txInfo = await api.getTransaction(txHash);
      if (txInfo) {
        const debugComment = txInfo.debugComment;
        const resultValue = txInfo.result;

        if (txInfo.state === "Halt") {
          return { status: "success", tx: txInfo };
        }

        const stillProcessing = txInfo.state === "Running";

        if (!stillProcessing) {
          const hasDebug =
            typeof debugComment === "string" && debugComment.trim().length > 0;
          if (!hasDebug && failureDetailAttempts < failureDetailMax) {
            failureDetailAttempts++;
          } else {
            const message = hasDebug
              ? debugComment.trim()
              : resultValue
                ? `Execution result: ${resultValue}`
                : `State: ${txInfo.state || "unknown"}`;
            return { status: "failure", tx: txInfo, message };
          }
        }
      }
    } catch (err) {
      console.warn(`[warn] getTransaction(${txHash}) failed`, err);
    }

    attempts++;
    if (attempts < maxAttempts) {
      await delay(delayMs);
    }
  }

  return { status: "timeout" };
}

/* ----------------------- series creation ------------------------- */

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
    addLog,
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
    const metadataList: { name: string; value: string | number | Uint8Array | bigint }[] = [];

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

    const metadataBytes = TokenSeriesMetadataBuilder.buildAndSerialize(
      seriesSchema,
      phantasmaSeriesId,
      metadataList as any, // SDK expects MetadataField[]; runtime shape matches
    );
    seriesInfo = new SeriesInfo({
      maxMint: 0,
      maxSupply: 0,
      owner: creatorPk,
      metadata: metadataBytes,
      rom: new VmStructSchema(),
      ram: new VmStructSchema(),
    });
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

/* ----------------------- error helpers ------------------------- */

function ensureError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : JSON.stringify(err));
}

function toMessage(err: unknown): string {
  return ensureError(err).message;
}

function isWalletSignResult(x: unknown): x is { hash: string; id: number; success: boolean; error?: string } {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return typeof v.hash === "string" && typeof v.id === "number" && typeof v.success === "boolean";
}
