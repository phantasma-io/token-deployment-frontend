import {
  Address,
  Bytes32,
  CarbonBinaryWriter,
  EasyConnect,
  FeeOptions,
  IntX,
  MintNftFeeOptions,
  MintNonFungibleTxHelper,
  MetadataField,
  NftRomBuilder,
  SmallString,
  TransactionData,
  TxMsg,
  TxMsgMintFungible,
  TxTypes,
  VmDynamicStruct,
  VmNamedDynamicVariable,
  VmStructSchema,
  VmType,
  getRandomPhantasmaId,
} from "phantasma-sdk-ts";

import { createApi } from "./api";
import { ensureError, toMessage } from "./errors";
import { waitForTransactionConfirmation } from "./tx";
import { extractPublicKeyBytes, isWalletSignResult } from "./wallet";
import { parseHexBytes, parseVmMetadataValue } from "./metadata";

export type MintNftParams = {
  conn: EasyConnect;
  carbonTokenId: bigint;
  carbonSeriesId: number;
  romSchema: VmStructSchema;
  metadataValues: Record<string, string>;
  romHex: string;
  ramSchema?: VmStructSchema | null;
  ramValues?: Record<string, string>;
  feeOptions?: MintNftFeeOptions;
  maxData?: bigint;
  expiry?: bigint | null;
  addLog?: (message: string, data?: unknown) => void;
};

export type MintNftResult =
  | {
      success: true;
      txHash: string;
      carbonNftAddresses?: string[];
      phantasmaNftId: string;
      result?: unknown;
    }
  | { success: false; error: string };

export async function mintNft(params: MintNftParams): Promise<MintNftResult> {
  const {
    conn,
    carbonTokenId,
    carbonSeriesId,
    romSchema,
    metadataValues,
    romHex,
    ramSchema,
    ramValues,
    feeOptions,
    maxData,
    expiry,
    addLog,
  } = params;

  if (!conn) {
    return { success: false, error: "Wallet connection (conn) is required" };
  }
  if (!romSchema) {
    return { success: false, error: "romSchema is required" };
  }

  let romBytes: Uint8Array;
  try {
    romBytes = parseHexBytes(romHex, "rom");
  } catch (err: unknown) {
    return { success: false, error: toMessage(err) };
  }

  const metadata: MetadataField[] = [{ name: "rom", value: romBytes }];
  const schemaFields = romSchema.fields ?? [];

  for (const field of schemaFields) {
    const name = String(field?.name?.data ?? "");
    if (!name || name === "_i" || name === "rom" || name === "id") {
      continue;
    }

    const rawValue = metadataValues[name] ?? "";
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return { success: false, error: `Metadata field '${name}' is required` };
    }

    const vmType = field?.schema?.type as VmType;
    let parsedValue: string | number | bigint | Uint8Array;
    try {
      parsedValue = parseVmMetadataValue(vmType, trimmed, name);
    } catch (err: unknown) {
      return { success: false, error: toMessage(err) };
    }

    metadata.push({ name, value: parsedValue });
  }

  let ramPayload = new Uint8Array();
  const ramFieldNames: string[] = [];
  if (ramSchema && Array.isArray(ramSchema.fields) && ramSchema.fields.length > 0) {
    const writer = new CarbonBinaryWriter();
    const ramStruct = new VmDynamicStruct();
    ramStruct.fields = [];
    const schemaFieldsRam = ramSchema.fields ?? [];
    for (const field of schemaFieldsRam) {
      const name = String(field?.name?.data ?? "");
      if (!name) {
        continue;
      }
      const providedValue = ramValues?.[name] ?? "";
      const trimmed = providedValue.trim();
      if (!trimmed) {
        return { success: false, error: `RAM field '${name}' is required` };
      }
      const vmType = field?.schema?.type as VmType;
      let parsedValue: string | number | bigint | Uint8Array;
      try {
        parsedValue = parseVmMetadataValue(vmType, trimmed, name);
      } catch (err: unknown) {
        return { success: false, error: toMessage(err) };
      }
      ramStruct.fields.push(VmNamedDynamicVariable.from(field.name, vmType, parsedValue));
      ramFieldNames.push(name);
    }
    ramStruct.writeWithSchema(ramSchema, writer);
    // CarbonBinaryWriter returns a Uint8Array typed with ArrayBufferLike, so re-wrap to match Uint8Array<ArrayBuffer>
    ramPayload = new Uint8Array(writer.toUint8Array());
  }

  addLog?.("[mint] Prepared metadata payload", {
    rom_keys: metadata.map((f) => f.name),
    ram_keys: ramFieldNames,
  });

  const phantasmaNftId = await getRandomPhantasmaId();

  let romPayload: Uint8Array;
  try {
    romPayload = NftRomBuilder.buildAndSerialize(romSchema, phantasmaNftId, metadata);
  } catch (err: unknown) {
    return { success: false, error: `Failed to serialize ROM metadata: ${toMessage(err)}` };
  }

  const publicKeyBytes = extractPublicKeyBytes(conn);
  const senderPk = new Bytes32(publicKeyBytes);
  const receiverPk = senderPk; // Mint to self for now

  const effectiveFee = feeOptions ?? new MintNftFeeOptions();
  const normalizedMaxData = maxData ?? 0n;
  const expiryValue = expiry ?? undefined;

  let txMsg;
  try {
    txMsg = MintNonFungibleTxHelper.buildTx(
      carbonTokenId,
      Number(carbonSeriesId),
      senderPk,
      receiverPk,
      romPayload,
      ramPayload,
      effectiveFee,
      normalizedMaxData,
      expiryValue,
    );
  } catch (err: unknown) {
    return { success: false, error: `Failed to build mint transaction: ${toMessage(err)}` };
  }

  addLog?.("[mint] Requesting wallet signature", { carbonSeriesId, carbonTokenId: String(carbonTokenId) });

  let walletResult: { hash: string; id: number; success: boolean };
  try {
    walletResult = await new Promise<{ hash: string; id: number; success: boolean }>((resolve, reject) => {
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
    });
  } catch (err: unknown) {
    return { success: false, error: toMessage(err) || "Wallet rejected transaction" };
  }

  const txHash = walletResult.hash;
  let carbonNftAddresses: string[] | undefined;

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
      const parsed = MintNonFungibleTxHelper.parseResult(
        carbonTokenId,
        txInfo.result,
      );
          carbonNftAddresses = parsed.map((addr) => addr?.ToHex?.() ?? "");
        } catch {
          carbonNftAddresses = undefined;
        }
      }
    } else if (confirmation.status === "failure") {
      const failure = confirmation as { status: "failure"; tx: TransactionData; message?: string };
      const message = failure.message
        ? failure.message
        : "Transaction execution failed";
      return { success: false, error: `Transaction ${txHash} failed: ${message}` };
    } else {
      return { success: false, error: `Transaction ${txHash} confirmation timed out` };
    }
  }

  addLog?.("[mint] Mint transaction submitted", {
    txHash,
    carbonNftAddresses,
    phantasmaNftId: phantasmaNftId.toString(),
  });

  return {
    success: true,
    txHash: txHash || "pending",
    carbonNftAddresses,
    phantasmaNftId: phantasmaNftId.toString(),
    result: walletResult,
  };
}

export type MintFungibleParams = {
  conn: EasyConnect;
  carbonTokenId: bigint;
  destinationAddress: string;
  amount: bigint;
  feeOptions?: FeeOptions;
  maxData?: bigint;
  expiry?: bigint | null;
  addLog?: (message: string, data?: unknown) => void;
};

export type MintFungibleResult =
  | { success: true; txHash: string; result?: unknown }
  | { success: false; error: string };

export async function mintFungible(params: MintFungibleParams): Promise<MintFungibleResult> {
  const { conn, carbonTokenId, destinationAddress, amount, feeOptions, maxData, expiry, addLog } = params;

  if (!conn) {
    return { success: false, error: "Wallet connection (conn) is required" };
  }
  const tokenId = carbonTokenId;
  const trimmedAddress = destinationAddress?.trim() ?? "";
  if (!trimmedAddress) {
    return { success: false, error: "Destination address is required" };
  }

  let receiverAddress: Address;
  try {
    receiverAddress = Address.FromText(trimmedAddress);
  } catch (err: unknown) {
    return {
      success: false,
      error: `Invalid destination address: ${toMessage(err)}`,
    };
  }

  let amountValue: bigint;
  try {
    amountValue = BigInt(amount);
  } catch {
    return { success: false, error: "Amount must be a valid integer" };
  }
  if (amountValue <= 0n) {
    return { success: false, error: "Amount must be greater than zero" };
  }

  let amountIntX: IntX;
  try {
    amountIntX = IntX.fromBigInt(amountValue);
  } catch (err: unknown) {
    return { success: false, error: `Amount cannot be encoded: ${toMessage(err)}` };
  }

  const receiverPk = receiverAddress.GetPublicKey();
  if (!receiverPk || receiverPk.length !== 32) {
    return {
      success: false,
      error: "Destination address is missing a valid 32-byte public key",
    };
  }

  const senderPkBytes = extractPublicKeyBytes(conn);
  const senderPk = new Bytes32(senderPkBytes);
  const recipientPk = new Bytes32(receiverPk);

  const normalizedMaxData = maxData ?? 0n;
  const expiryValue = expiry ?? undefined;

  const fees = feeOptions ?? new FeeOptions();

  const mintMsg = new TxMsgMintFungible();
  mintMsg.tokenId = tokenId;
  mintMsg.to = recipientPk;
  mintMsg.amount = amountIntX;

  const txMsg = new TxMsg();
  txMsg.type = TxTypes.MintFungible;
  txMsg.expiry = expiryValue ?? BigInt(Date.now() + 60_000);
  txMsg.maxGas = fees.calculateMaxGas();
  txMsg.maxData = normalizedMaxData;
  txMsg.gasFrom = senderPk;
  txMsg.payload = SmallString.empty;
  txMsg.msg = mintMsg;

  addLog?.("[mint] Prepared fungible mint tx", {
    tokenId: tokenId.toString(),
    destinationAddress: trimmedAddress,
    amount: amountValue.toString(),
    maxData: normalizedMaxData?.toString() ?? null,
    expiry: txMsg.expiry.toString(),
  });

  let walletResult: { hash: string; id: number; success: boolean };
  try {
    walletResult = await new Promise<{ hash: string; id: number; success: boolean }>((resolve, reject) => {
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
    });
  } catch (err: unknown) {
    return {
      success: false,
      error: toMessage(err) || "Wallet rejected transaction",
    };
  }

  const txHash = walletResult.hash;

  if (txHash) {
    const api = createApi();
    const confirmation = await waitForTransactionConfirmation(api, txHash, {
      maxAttempts: 30,
      delayMs: 1000,
      failureDetailAttempts: 6,
    });

    if (confirmation.status === "failure") {
      const failure = confirmation as { status: "failure"; tx: TransactionData; message?: string };
      const message = failure.message
        ? failure.message
        : "Transaction execution failed";
      return { success: false, error: `Transaction ${txHash} failed: ${message}` };
    }

    if (confirmation.status !== "success") {
      return { success: false, error: `Transaction ${txHash} confirmation timed out` };
    }
  }

  addLog?.("[mint] Fungible mint transaction submitted", {
    tokenId: tokenId.toString(),
    destinationAddress: trimmedAddress,
    amount: amountValue.toString(),
    txHash: txHash || "pending",
  });

  return {
    success: true,
    txHash: txHash || "pending",
    result: walletResult,
  };
}
