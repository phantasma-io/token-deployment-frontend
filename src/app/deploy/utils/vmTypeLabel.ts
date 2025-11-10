import { VmType } from "phantasma-sdk-ts";

export function formatVmTypeLabel(value: VmType): string {
  const mapped = VmType[value as number];
  return typeof mapped === "string" ? mapped : String(value);
}
