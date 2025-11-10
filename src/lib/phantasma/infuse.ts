"use client";

import {
  Bytes32,
  CarbonBinaryWriter,
  EasyConnect,
  FeeOptions,
  ModuleId,
  SmallString,
  TxMsg,
  TxMsgCall,
  TxMsgCallMulti,
  TxMsgTransferNonFungibleMulti,
  TxMsgTransferNonFungibleSingle,
  TxTypes,
  TokenContract_Methods,
  hexToBytes,
} from "phantasma-sdk-ts";

import { extractPublicKeyBytes } from "./wallet";
import { createApi } from "./api";
import { waitForTransactionConfirmation } from "./tx";
import { ensureError, toMessage } from "./errors";

export type InfuseInstanceGroup = {
  carbonTokenId: bigint;
  instanceIds: bigint[];
};

export type InfuseParams = {
  conn: EasyConnect;
  targetCarbonAddress: string;
  groups: InfuseInstanceGroup[];
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
    targetCarbonAddress,
    groups,
    feeOptions,
    maxData,
    expiry,
  } = params;

  if (!conn) {
    return { success: false, error: "Wallet connection is required" };
  }
  if (!groups || groups.length === 0) {
    return { success: false, error: "Select at least one NFT to infuse" };
  }
  const normalizedGroups: InfuseInstanceGroup[] = [];
  for (const group of groups) {
    if (!group) continue;
    if (group.carbonTokenId === undefined || group.carbonTokenId === null) {
      return { success: false, error: "Missing carbon token id for infusion group" };
    }
    const ids = Array.isArray(group.instanceIds) ? group.instanceIds : [];
    if (ids.length === 0) continue;
    normalizedGroups.push({
      carbonTokenId: BigInt(group.carbonTokenId),
      instanceIds: ids.map((id) => BigInt(id)),
    });
  }
  if (normalizedGroups.length === 0) {
    return { success: false, error: "Select at least one NFT to infuse" };
  }
  const totalInstances = normalizedGroups.reduce((sum, group) => sum + group.instanceIds.length, 0);
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

  const senderPk = new Bytes32(extractPublicKeyBytes(conn));
  const fee = feeOptions ?? new FeeOptions();
  const expiryValue = expiry ?? BigInt(Date.now() + 60_000);

  let tx: TxMsg;
  if (normalizedGroups.length === 1) {
    const group = normalizedGroups[0];
    const ids = group.instanceIds;
    if (ids.length === 1) {
      const msg = new TxMsgTransferNonFungibleSingle({
        to: toBytes,
        tokenId: group.carbonTokenId,
        instanceId: ids[0],
      });
      tx = new TxMsg(
        TxTypes.TransferNonFungible_Single,
        expiryValue,
        fee.calculateMaxGas(1),
        maxData ?? 0n,
        senderPk,
        SmallString.empty,
        msg,
      );
    } else {
      const msg = new TxMsgTransferNonFungibleMulti({
        to: toBytes,
        tokenId: group.carbonTokenId,
        instanceIds: ids,
      });
      tx = new TxMsg(
        TxTypes.TransferNonFungible_Multi,
        expiryValue,
        fee.calculateMaxGas(ids.length),
        maxData ?? 0n,
        senderPk,
        SmallString.empty,
        msg,
      );
    }
  } else {
    const calls: TxMsgCall[] = normalizedGroups.map((group) => {
      const argsWriter = new CarbonBinaryWriter();
      argsWriter.write32(toBytes);
      argsWriter.write32(senderPk);
      argsWriter.write8u(BigInt(group.carbonTokenId));
      argsWriter.write4u(group.instanceIds.length);
      for (const instanceId of group.instanceIds) {
        argsWriter.write8u(instanceId);
      }
      return new TxMsgCall(ModuleId.Token, TokenContract_Methods.TransferNonFungible, argsWriter.toUint8Array());
    });
    const callMulti = new TxMsgCallMulti(calls);
    tx = new TxMsg(
      TxTypes.Call_Multi,
      expiryValue,
      fee.calculateMaxGas(totalInstances),
      maxData ?? 0n,
      senderPk,
      SmallString.empty,
      callMulti,
    );
  }

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
