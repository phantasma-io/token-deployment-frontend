"use client";

import {
  ContractTxHelper,
  PhantasmaLink,
  ProofOfWork,
  ScriptBuilder,
  Transaction,
} from "phantasma-sdk-ts";

import { NEXUS, createApi } from "./api";
import { ensureError, toMessage } from "./errors";
import { waitForTransactionConfirmation } from "./tx";

export type ContractLifecycleOperation = "deploy" | "upgrade" | "attach";
export type ContractLifecycleFlow =
  | "contractDeploy"
  | "contractUpgrade"
  | "tokenAttach"
  | "tokenUpgrade";

export type ContractLifecycleParams = {
  conn: ContractLifecycleConnection;
  contractName?: string;
  tokenSymbol?: string;
  script: Uint8Array;
  abi: Uint8Array;
  flow: ContractLifecycleFlow;
  gasPrice?: number;
  gasLimit?: number;
  proofOfWork?: number;
  addLog?: (message: string, data?: unknown) => void;
};

export type ContractLifecycleResult =
  | { success: true; txHash: string; scriptHex: string }
  | { success: false; error: string; scriptHex?: string };

export const CONTRACT_HEAVY_DEFAULT_GAS_PRICE = 100000;
export const CONTRACT_HEAVY_DEFAULT_GAS_LIMIT = 1100000000;

const CONTRACT_TX_EXPIRATION_MS = 5 * 60 * 1000;
const CONTRACT_MAIN_CHAIN = "main";
const CONTRACT_LIFECYCLE_PAYLOAD = "contract-lifecycle";

type ContractLifecycleGasDefaults = {
  gasPrice: number;
  gasLimit: number;
};

type PreparedContractLifecycleTransaction = {
  scriptHex: string;
  unsignedTx: Transaction;
  gasPrice: number;
  gasLimit: number;
  operation: ContractLifecycleOperation;
};

type CompatibleLinkSignResult = {
  success?: boolean;
  signature?: string;
  signedTx?: string;
};

type CompatiblePhantasmaLink = {
  account?: {
    address?: string;
  };
  nexus?: string;
  chain?: string;
  platform?: string;
  socketTransport?: string | null;
  getNexus?: (...args: unknown[]) => void;
  signPrebuiltTransaction?: (
    tx: Transaction,
    callback: (result: CompatibleLinkSignResult) => void,
    onErrorCallback: (message?: string) => void,
    signature?: string,
  ) => void;
};

export type ContractLifecycleConnection = {
  link: unknown;
  signPrebuiltTransaction?: unknown;
};

function ensureLinkSigningCompat(link: CompatiblePhantasmaLink): CompatiblePhantasmaLink {
  const runtimeLink = link as Record<string, unknown>;
  const sdkLinkPrototype = PhantasmaLink.prototype as unknown as Record<string, unknown>;

  if (typeof runtimeLink["decodeWalletSignatureBytes"] !== "function") {
    runtimeLink["decodeWalletSignatureBytes"] = sdkLinkPrototype.decodeWalletSignatureBytes;
  }

  if (typeof sdkLinkPrototype.signTxSignature === "function") {
    runtimeLink["signTxSignature"] = sdkLinkPrototype.signTxSignature;
  }

  if (typeof runtimeLink["signPrebuiltTransaction"] !== "function") {
    runtimeLink["signPrebuiltTransaction"] = sdkLinkPrototype.signPrebuiltTransaction;
  }

  return runtimeLink as CompatiblePhantasmaLink;
}

async function resolveWalletNexus(link: CompatiblePhantasmaLink): Promise<string> {
  const fallbackNexus = (link.nexus || "").trim();

  if (typeof link.getNexus !== "function") {
    return fallbackNexus;
  }

  try {
    return await new Promise<string>((resolve) => {
      link.getNexus?.(
        (result: unknown) => {
          if (
            result &&
            typeof result === "object" &&
            typeof (result as { nexus?: unknown }).nexus === "string"
          ) {
            const nexus = (result as { nexus: string }).nexus.trim();
            link.nexus = nexus;
            resolve(nexus);
            return;
          }

          resolve(fallbackNexus);
        },
        () => resolve(fallbackNexus),
      );
    });
  } catch {
    return fallbackNexus;
  }
}

async function signPrebuiltTransactionCompat(
  conn: ContractLifecycleConnection,
  tx: Transaction,
): Promise<string> {
  const directSigner = conn.signPrebuiltTransaction;
  if (typeof directSigner === "function") {
    return await new Promise<string>((resolve, reject) => {
      directSigner(
        tx,
        (res: CompatibleLinkSignResult) => {
          if (typeof res?.signedTx !== "string" || !res.signedTx.trim()) {
            reject(new Error("Unexpected wallet signing response"));
            return;
          }

          resolve(res.signedTx);
        },
        (message?: string) => {
          reject(ensureError(message ?? "Wallet rejected transaction signature"));
        },
      );
    });
  }

  const link = ensureLinkSigningCompat(conn.link as CompatiblePhantasmaLink);
  if (typeof link.signPrebuiltTransaction !== "function") {
    throw new Error("Wallet signing path is unavailable");
  }

  return await new Promise<string>((resolve, reject) => {
    link.signPrebuiltTransaction?.(
      tx,
      (res: CompatibleLinkSignResult) => {
        if (typeof res?.signedTx !== "string" || !res.signedTx.trim()) {
          reject(new Error("Unexpected wallet signing response"));
          return;
        }

        resolve(res.signedTx);
      },
      (message?: string) => {
        reject(ensureError(message ?? "Wallet rejected transaction signature"));
      },
    );
  });
}

function requireRpcTxHash(rpcResult: unknown, context: string): string {
  if (typeof rpcResult === "string" && rpcResult.trim().length > 0) {
    return rpcResult;
  }

  if (rpcResult && typeof rpcResult === "object") {
    const record = rpcResult as Record<string, unknown>;

    if (typeof record.hash === "string" && record.hash.trim().length > 0) {
      return record.hash;
    }

    if ("error" in record) {
      const errorValue = record.error;
      throw new Error(
        `${context} RPC error: ${
          typeof errorValue === "string" && errorValue.trim().length > 0
            ? errorValue
            : JSON.stringify(errorValue)
        }`,
      );
    }
  }

  throw new Error(`${context} RPC returned a non-hash result: ${JSON.stringify(rpcResult)}`);
}

export function getContractLifecycleOperation(
  flow: ContractLifecycleFlow,
): ContractLifecycleOperation {
  switch (flow) {
    case "contractDeploy":
      return "deploy";
    case "contractUpgrade":
      return "upgrade";
    case "tokenAttach":
      return "attach";
    case "tokenUpgrade":
      return "upgrade";
  }
}

export function getContractLifecycleGasDefaults(
  flow: ContractLifecycleFlow,
): ContractLifecycleGasDefaults {
  switch (flow) {
    case "contractDeploy":
      return {
        gasPrice: CONTRACT_HEAVY_DEFAULT_GAS_PRICE,
        gasLimit: CONTRACT_HEAVY_DEFAULT_GAS_LIMIT,
      };
    case "contractUpgrade":
    case "tokenUpgrade":
      return {
        gasPrice: ContractTxHelper.DefaultGasPrice,
        gasLimit: ContractTxHelper.DefaultGasLimit,
      };
    case "tokenAttach":
      return {
        gasPrice: CONTRACT_HEAVY_DEFAULT_GAS_PRICE,
        gasLimit: CONTRACT_HEAVY_DEFAULT_GAS_LIMIT,
      };
  }
}

function resolveContractLifecycleGas(
  flow: ContractLifecycleFlow,
  gasPrice?: number,
  gasLimit?: number,
): ContractLifecycleGasDefaults {
  const defaults = getContractLifecycleGasDefaults(flow);
  return {
    gasPrice: gasPrice ?? defaults.gasPrice,
    gasLimit: gasLimit ?? defaults.gasLimit,
  };
}

function buildAttachScript(params: {
  fromAddress: string;
  tokenSymbol: string;
  script: Uint8Array;
  abi: Uint8Array;
  gasPrice: number;
  gasLimit: number;
}): string {
  const nullAddress = new ScriptBuilder().NullAddress;

  return new ScriptBuilder()
    .BeginScript()
    .AllowGas(params.fromAddress, nullAddress, params.gasPrice, params.gasLimit)
    .CallInterop("Nexus.AttachTokenContract", [
      params.fromAddress,
      params.tokenSymbol,
      params.script,
      params.abi,
    ])
    .SpendGas(params.fromAddress)
    .EndScript();
}

function buildUnsignedContractLifecycleTransaction(params: {
  flow: ContractLifecycleFlow;
  nexus: string;
  chain: string;
  expiration: Date;
  fromAddress: string;
  contractName?: string;
  tokenSymbol?: string;
  script: Uint8Array;
  abi: Uint8Array;
  gasPrice?: number;
  gasLimit?: number;
}): PreparedContractLifecycleTransaction {
  const operation = getContractLifecycleOperation(params.flow);
  const { gasPrice, gasLimit } = resolveContractLifecycleGas(
    params.flow,
    params.gasPrice,
    params.gasLimit,
  );

  if (operation === "attach") {
    const tokenSymbol = params.tokenSymbol?.trim();
    if (!tokenSymbol) {
      throw new Error("Token symbol is required for token attach");
    }

    const scriptHex = buildAttachScript({
      fromAddress: params.fromAddress,
      tokenSymbol,
      script: params.script,
      abi: params.abi,
      gasPrice,
      gasLimit,
    });

    return {
      scriptHex,
      unsignedTx: new Transaction(
        params.nexus,
        params.chain,
        scriptHex,
        params.expiration,
        ContractTxHelper.encodePayloadText(CONTRACT_LIFECYCLE_PAYLOAD),
      ),
      gasPrice,
      gasLimit,
      operation,
    };
  }

  const contractName = params.contractName?.trim();
  if (!contractName) {
    throw new Error("Contract name is required for contract deploy or upgrade");
  }

  const unsignedTx =
    operation === "deploy"
      ? ContractTxHelper.buildDeployTransaction({
          nexus: params.nexus,
          chain: params.chain,
          expiration: params.expiration,
          from: params.fromAddress,
          contractName,
          script: params.script,
          abi: params.abi,
          gasPrice,
          gasLimit,
        })
      : ContractTxHelper.buildUpgradeTransaction({
          nexus: params.nexus,
          chain: params.chain,
          expiration: params.expiration,
          from: params.fromAddress,
          contractName,
          script: params.script,
          abi: params.abi,
          gasPrice,
          gasLimit,
        });

  return {
    scriptHex: unsignedTx.script,
    unsignedTx,
    gasPrice,
    gasLimit,
    operation,
  };
}

export async function submitContractLifecycle(
  params: ContractLifecycleParams,
): Promise<ContractLifecycleResult> {
  const {
    conn,
    contractName,
    tokenSymbol,
    script,
    abi,
    flow,
    gasPrice,
    gasLimit,
    proofOfWork = ProofOfWork.Minimal,
    addLog,
  } = params;

  if (!conn) {
    return { success: false, error: "Wallet connection is required" };
  }

  const link = conn.link as CompatiblePhantasmaLink;
  const fromAddress = link?.account?.address;
  if (!fromAddress || typeof fromAddress !== "string") {
    return { success: false, error: "Wallet account address is unavailable" };
  }

  const operation = getContractLifecycleOperation(flow);
  const normalizedContractName = contractName?.trim();
  const normalizedTokenSymbol = tokenSymbol?.trim();

  if (operation === "attach" && !normalizedTokenSymbol) {
    return {
      success: false,
      error: "Token symbol is required for token attach",
    };
  }

  if (operation !== "attach" && !normalizedContractName) {
    return {
      success: false,
      error: "Contract name is required for contract deploy or upgrade",
    };
  }

  const configuredNexus = NEXUS.trim();
  const walletNexus = await resolveWalletNexus(link);
  const nexus = (configuredNexus || walletNexus).trim();
  const chain = (link?.chain || CONTRACT_MAIN_CHAIN).trim();

  if (!nexus) {
    return {
      success: false,
      error: "NEXT_PUBLIC_PHANTASMA_NEXUS is required for contract lifecycle transactions",
    };
  }
  if (!chain) {
    return {
      success: false,
      error: "Wallet chain is unavailable",
    };
  }

  const expiration = new Date(Date.now() + CONTRACT_TX_EXPIRATION_MS);
  let preparedTx: PreparedContractLifecycleTransaction;
  let scriptHex: string | undefined;
  try {
    preparedTx = buildUnsignedContractLifecycleTransaction({
      flow,
      nexus,
      chain,
      expiration,
      fromAddress,
      contractName: normalizedContractName,
      tokenSymbol: normalizedTokenSymbol,
      script,
      abi,
      gasPrice,
      gasLimit,
    });
    scriptHex = preparedTx.scriptHex;
  } catch (err: unknown) {
    return { success: false, error: toMessage(err) };
  }

  if (!Number.isSafeInteger(proofOfWork) || proofOfWork < ProofOfWork.Minimal) {
    return {
      success: false,
      error: `Contract lifecycle requires proof of work >= ${ProofOfWork.Minimal}`,
      scriptHex,
    };
  }

  addLog?.("[contract] Prepared contract lifecycle transaction", {
    flow,
    operation: preparedTx.operation,
    contractName: normalizedContractName ?? null,
    tokenSymbol: normalizedTokenSymbol ?? null,
    fromAddress,
    nexus,
    chain,
    scriptBytes: script.length,
    abiBytes: abi.length,
    scriptHex,
    gasPrice: preparedTx.gasPrice,
    gasLimit: preparedTx.gasLimit,
    proofOfWork,
    payloadText: CONTRACT_LIFECYCLE_PAYLOAD,
    txTransport: "conn.link.signTxSignature + rpc.sendRawTransaction",
  });

  if (
    configuredNexus.length > 0 &&
    walletNexus.length > 0 &&
    configuredNexus.toLowerCase() !== walletNexus.toLowerCase()
  ) {
    addLog?.("[contract][error] Frontend nexus does not match connected wallet nexus", {
      configuredNexus,
      walletNexus,
    });
    return {
      success: false,
      error: `Configured frontend nexus ${configuredNexus} does not match connected wallet nexus ${walletNexus}. Frontend is pinned to ${configuredNexus}; switch the wallet network or update the frontend config.`,
      scriptHex,
    };
  }

  if (link.socketTransport !== "websocket") {
    return {
      success: false,
      error:
        "Contract lifecycle currently requires local socket transport because injected wallet transport does not preserve PoW for these transactions.",
      scriptHex,
    };
  }

  let signedTxHex: string;
  try {
    preparedTx.unsignedTx.mineTransaction(proofOfWork);

    addLog?.("[contract] Prepared raw legacy transaction", {
      expiration: expiration.toISOString(),
      payloadHex: preparedTx.unsignedTx.payload,
      unsignedTxHexLength: preparedTx.unsignedTx.ToStringEncoded(false).toUpperCase().length,
    });

    signedTxHex = (await signPrebuiltTransactionCompat(conn, preparedTx.unsignedTx)).toUpperCase();
  } catch (err: unknown) {
    return {
      success: false,
      error: toMessage(err) || "Wallet rejected transaction",
      scriptHex,
    };
  }

  addLog?.("[contract] Signed raw legacy transaction", {
    signedTxHexLength: signedTxHex.length,
  });

  const api = createApi();
  let txHash: string;
  try {
    txHash = requireRpcTxHash(
      await api.sendRawTransaction(signedTxHex),
      "contract lifecycle",
    );
  } catch (err: unknown) {
    return {
      success: false,
      error: toMessage(err),
      scriptHex,
    };
  }

  const confirmation = await waitForTransactionConfirmation(api, txHash, {
    maxAttempts: 30,
    delayMs: 1000,
    failureDetailAttempts: 6,
  });

  if (confirmation.status === "success") {
    return {
      success: true,
      txHash,
      scriptHex,
    };
  }

  if (confirmation.status === "failure") {
    const message = confirmation.message ?? "Transaction execution failed";
    return {
      success: false,
      error: `Transaction ${txHash} failed: ${message}`,
      scriptHex,
    };
  }

  return {
    success: false,
    error: `Transaction ${txHash} confirmation timed out`,
    scriptHex,
  };
}
