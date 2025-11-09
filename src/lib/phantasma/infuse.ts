"use client";

import {
  Bytes32,
  EasyConnect,
  FeeOptions,
  SmallString,
  TxMsg,
  TxMsgTransferNonFungibleMulti,
  TxTypes,
  hexToBytes,
} from "phantasma-sdk-ts";

import { extractPublicKeyBytes } from "./wallet";
import { createApi } from "./api";
import { waitForTransactionConfirmation } from "./tx";
import { ensureError, toMessage } from "./errors";

export type InfuseParams = {
  conn: EasyConnect;
  carbonTokenId: bigint;
  targetCarbonAddress: string;
  instanceIds: bigint[];
  feeOptions?: FeeOptions;
  maxData?: bigint;
  expiry?: bigint;
};

export type InfuseResult =
  | { success: true; txHash: string }
  | { success: false; error: string };

export async function infuseNfts(params: InfuseParams): Promise<InfuseResult> {
  const {
    conn,
    carbonTokenId,
    targetCarbonAddress,
    instanceIds,
    feeOptions,
    maxData,
    expiry,
  } = params;

  if (!conn) {
    return { success: false, error: "Wallet connection is required" };
  }
  if (!instanceIds || instanceIds.length === 0) {
    return { success: false, error: "Select at least one NFT to infuse" };
  }
  const trimmedTargetAddress = targetCarbonAddress.trim();
  if (!targetCarbonAddress || !trimmedTargetAddress) {
    return { success: false, error: "Target NFT address is required" };
  }

  let toBytes: Bytes32;
  try {
    toBytes = new Bytes32(hexToBytes(trimmedTargetAddress));
  } catch (err: unknown) {
    return { success: false, error: `Invalid target NFT address: ${toMessage(err)}` };
  }

  const fee = feeOptions ?? new FeeOptions();
  const expiryValue = expiry ?? BigInt(Date.now() + 60_000);

  const msg = new TxMsgTransferNonFungibleMulti({
    to: toBytes,
    tokenId: carbonTokenId,
    instanceIds,
  });

  const tx = new TxMsg(
    TxTypes.TransferNonFungible_Multi,
    expiryValue,
    fee.calculateMaxGas(instanceIds.length),
    maxData ?? 0n,
    new Bytes32(extractPublicKeyBytes(conn)),
    SmallString.empty,
    msg,
  );

  let walletResult: { hash: string; id: number; success: boolean };
  try {
    walletResult = await new Promise<{ hash: string; id: number; success: boolean }>((resolve, reject) => {
      conn.signCarbonTransaction(
        tx,
        (res: unknown) => {
          if (!res || typeof res !== "object") {
            reject(new Error("Unexpected wallet response"));
            return;
          }
          const result = res as { hash?: string; id?: number; success?: boolean; error?: string };
          if (!result.success) {
            reject(new Error(result.error || "Wallet rejected transaction"));
            return;
          }
          resolve({ hash: result.hash || "", id: result.id ?? 0, success: true });
        },
        (err: unknown) => {
          reject(ensureError(err));
        },
      );
    });
  } catch (err: unknown) {
    return { success: false, error: toMessage(err) || "Wallet rejected transaction" };
  }

  const txHash = walletResult.hash;
  if (!txHash) {
    return { success: true, txHash: "" };
  }

  const api = createApi();
  const confirmation = await waitForTransactionConfirmation(api, txHash, {
    maxAttempts: 30,
    delayMs: 1000,
    failureDetailAttempts: 6,
  });

  if (confirmation.status === "success") {
    return { success: true, txHash };
  }
  if (confirmation.status === "failure") {
    const message = confirmation.message ?? "Transaction execution failed";
    return { success: false, error: `Transaction ${txHash} failed: ${message}` };
  }
  return { success: false, error: `Transaction ${txHash} confirmation timed out` };
}
