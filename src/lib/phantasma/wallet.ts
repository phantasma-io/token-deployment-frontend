import { Address, EasyConnect } from "phantasma-sdk-ts";

export function extractPublicKeyBytes(conn: EasyConnect): Uint8Array {
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
      `Failed to parse wallet address '${addressText}': ${(err as Error)?.message ?? String(err)}`,
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

export type WalletSignResult = { hash: string; id: number; success: boolean; error?: string };

export function isWalletSignResult(x: unknown): x is WalletSignResult {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return typeof v.hash === "string" && typeof v.id === "number" && typeof v.success === "boolean";
}
