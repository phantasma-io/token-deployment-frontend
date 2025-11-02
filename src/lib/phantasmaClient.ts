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
  PhantasmaAPI,
  TokenMetadataBuilder,
  CreateTokenFeeOptions,
  EasyConnect,
  TransactionData,
} from "phantasma-sdk-ts";

export type TokenInfo = any;

export type DeployParams = {
  conn: EasyConnect; // wallet connection object (phaCtx.conn)
  ownerAddress: string;
  symbol: string;
  name?: string;
  isNFT: boolean;
  decimals: number;
  maxSupply: bigint;
  metadata?: Record<string, string>;
  feeOptions?: CreateTokenFeeOptions;
  maxData: bigint;
  expiry?: bigint | number | null;
};

export type DeployResult =
  | { success: true; txHash: string; tokenId?: number; result?: any }
  | { success: false; error: string };

const RPC_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5172/rpc";
const NEXUS = (process.env.NEXT_PUBLIC_PHANTASMA_NEXUS as string) || "testnet";

function createApi() {
  return new PhantasmaAPI(RPC_URL, undefined, NEXUS);
}

/**
 * Fetch tokens for an owner address via server API.
 */
export async function getTokens(ownerAddress: string): Promise<TokenInfo[]> {
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
  } catch (error) {
    console.error("[error] getTokens: RPC call failed", { error });
    throw error;
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
    feeOptions,
    maxData,
    expiry,
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
  try {
    tokenInfoInstance = TokenInfoBuilder.build(
      symbol.trim(),
      IntX.fromBigInt(maxSupply),
      isNFT,
      decimals,
      ownerBytes32,
      TokenMetadataBuilder.buildAndSerialize(metadata ?? {})
    );
  } catch {
    return {
      success: false,
      error: "Failed to build TokenInfo struct",
    };
  }

  const expiryValue =
    expiry !== undefined && expiry !== null ? BigInt(expiry) : undefined;

  let txMsg;
  try {
    txMsg = CreateTokenTxHelper.buildTx(
      tokenInfoInstance,
      ownerBytes32 ?? tokenInfoInstance.owner ?? new Bytes32(),
      feeOptions,
      maxData,
      expiryValue,
    );
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to build Carbon tx: ${err?.message || String(err)}`,
    };
  }

  let walletResult: {hash: string, id: number, success: boolean};
  try {
    walletResult = await new Promise<{hash: string, id: number, success: boolean}>((resolve, reject) => {
      try {
        conn.signCarbonTransaction(
          txMsg,
          (res: any) => {
            if (res?.success === false) {
              reject(new Error(res?.error || "Wallet rejected transaction"));
              return;
            }
            resolve(res);
          },
          (err: any) => {
            if (!err) {
              reject(new Error("Wallet rejected transaction"));
            } else if (err instanceof Error) {
              reject(err);
            } else if (typeof err === "string") {
              reject(new Error(err));
            } else {
              reject(new Error(JSON.stringify(err)));
            }
          },
        );
      } catch (inner) {
        reject(inner);
      }
    });
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Wallet rejected transaction",
    };
  }

  console.log("[wallet] walletResult received", walletResult);

  const txHash = walletResult.hash;
  let tokenId: number | undefined = undefined;

  if (txHash) {
    const api = createApi();
    const confirmation = await waitForTransactionConfirmation(api, txHash, {
      maxAttempts: 30,
      delayMs: 1000,
      failureDetailAttempts: 6,
    });

    if (confirmation.status === "success") {
      const txInfo = confirmation.tx;
      if (typeof txInfo?.result === "string") {
        try {
          tokenId = CreateTokenTxHelper.parseResult(txInfo?.result);
        } catch {
          tokenId = undefined;
        }
      }
    } else if (confirmation.status === "failure") {
      const message = confirmation.message
        ? `${confirmation.message}`
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

function extractPublicKeyBytes(conn: any): Uint8Array {
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
