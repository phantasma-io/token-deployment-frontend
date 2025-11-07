import { VmType, hexToBytes } from "phantasma-sdk-ts";

const INT_REGEX = /^-?\d+$/;

export type VmMetadataValue = string | number | bigint | Uint8Array;

export function parseHexBytes(input: string, fieldName: string): Uint8Array {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return new Uint8Array();
  }
  const normalized = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (normalized.length === 0) {
    return new Uint8Array();
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`Field '${fieldName}' must be a hex string`);
  }
  if (normalized.length % 2 !== 0) {
    throw new Error(`Field '${fieldName}' hex length must be even`);
  }
  return hexToBytes(normalized);
}

export function parseVmMetadataValue(type: VmType, value: string, fieldName: string): VmMetadataValue {
  switch (type) {
    case VmType.String:
      return value;
    case VmType.Int8:
    case VmType.Int16:
    case VmType.Int32:
      if (!INT_REGEX.test(value)) {
        throw new Error(`Field '${fieldName}' must be a signed integer`);
      }
      return Number.parseInt(value, 10);
    case VmType.Int64:
    case VmType.Int256:
      if (!INT_REGEX.test(value)) {
        throw new Error(`Field '${fieldName}' must be a signed integer`);
      }
      return BigInt(value);
    case VmType.Bytes:
    case VmType.Bytes16:
    case VmType.Bytes32:
    case VmType.Bytes64:
      return parseHexBytes(value, fieldName);
    default:
      return value;
  }
}
