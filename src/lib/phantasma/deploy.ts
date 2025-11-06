import {
  Bytes32,
  CreateTokenFeeOptions,
  CreateTokenTxHelper,
  EasyConnect,
  IntX,
  TokenInfo as DeploymentTokenInfo,
  TokenInfoBuilder,
  TokenMetadataBuilder,
  TokenSchemas,
  TokenSchemasBuilder,
  TransactionData,
} from "phantasma-sdk-ts";

import { createApi } from "./api";
import { ensureError, toMessage } from "./errors";
import { waitForTransactionConfirmation } from "./tx";
import { extractPublicKeyBytes } from "./wallet";

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
      // Parse and validate via SDK
      tokenSchemas = TokenSchemasBuilder.fromJson(tokenSchemasJson);
      addLog?.("[schemas] Using TokenSchemas", { tokenSchemas });
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
      ownerBytes32,
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
      const message = failure.message ? `${failure.message}` : "Transaction execution failed";
      return { success: false, error: `Transaction ${txHash} failed: ${message}` };
    } else {
      return { success: false, error: `Transaction ${txHash} confirmation timed out` };
    }
  }

  return {
    success: true,
    txHash: txHash || "pending",
    tokenId,
    result: walletResult,
  };
}

function isWalletSignResult(x: unknown): x is { hash: string; id: number; success: boolean; error?: string } {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return typeof v.hash === "string" && typeof v.id === "number" && typeof v.success === "boolean";
}

