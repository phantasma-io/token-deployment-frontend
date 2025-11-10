export const ROYALTIES_UNIT_DECIMALS = 7;
export const ROYALTIES_MAX_PERCENT = 100;

export type RoyaltiesConversion =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; baseUnits: bigint };

export function convertRoyaltiesPercent(raw: string): RoyaltiesConversion {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: "error", message: "Use a numeric value like 12 or 12.5" };
  }
  const asNumber = Number(trimmed);
  if (!Number.isFinite(asNumber)) {
    return { kind: "error", message: "Invalid royalties value" };
  }
  if (asNumber < 0) {
    return { kind: "error", message: "Royalties cannot be negative" };
  }
  if (asNumber > ROYALTIES_MAX_PERCENT) {
    return { kind: "error", message: `Maximum is ${ROYALTIES_MAX_PERCENT}%` };
  }
  const [wholePart, fractionPartRaw = ""] = trimmed.split(".");
  if (fractionPartRaw.length > ROYALTIES_UNIT_DECIMALS) {
    return {
      kind: "error",
      message: `Use at most ${ROYALTIES_UNIT_DECIMALS} decimals`,
    };
  }
  const paddedFraction = fractionPartRaw.padEnd(ROYALTIES_UNIT_DECIMALS, "0");
  const combined = `${wholePart}${paddedFraction}`.replace(/^0+/, "") || "0";
  const baseUnits = BigInt(combined);
  return { kind: "ok", baseUnits };
}
