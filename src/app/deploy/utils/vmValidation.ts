import { VmType } from "phantasma-sdk-ts";

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const INT_REGEX = /^-?\d+$/;

export function isHexValueValid(value: string): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  const normalized = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (normalized.length === 0) {
    return true;
  }
  return HEX_REGEX.test(normalized) && normalized.length % 2 === 0;
}

export function isVmValueValid(vmType: VmType | number | undefined, raw: string): boolean {
  if (vmType === undefined || vmType === null) return true;
  switch (vmType) {
    case VmType.String:
      return raw.trim().length > 0;
    case VmType.Int8:
    case VmType.Int16:
    case VmType.Int32:
    case VmType.Int64:
    case VmType.Int256:
      return INT_REGEX.test(raw);
    case VmType.Bytes:
    case VmType.Bytes16:
    case VmType.Bytes32:
    case VmType.Bytes64:
      return isHexValueValid(raw);
    default:
      return true;
  }
}
