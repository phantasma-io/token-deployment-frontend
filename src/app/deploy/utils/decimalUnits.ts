const AMOUNT_REGEX = /^\d+(\.\d+)?$/;

export const INTX_MAX_VALUE = (1n << 255n) - 1n;

export type ParseAmountResult =
  | { ok: true; baseUnits: bigint }
  | { ok: false; error: string };

export type ParseAmountOptions = {
  label?: string;
  allowEmpty?: boolean;
  allowZero?: boolean;
};

function pow10(decimals: number): bigint {
  let result = 1n;
  for (let i = 0; i < decimals; i++) {
    result *= 10n;
  }
  return result;
}

export function parseHumanAmountToBaseUnits(
  raw: string,
  decimals: number,
  options?: ParseAmountOptions,
): ParseAmountResult {
  const label = options?.label ?? "Amount";
  if (!Number.isInteger(decimals) || decimals < 0) {
    return {
      ok: false,
      error: `${label}: Decimals must be a non-negative integer`,
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    if (options?.allowEmpty) {
      return { ok: true, baseUnits: 0n };
    }
    return { ok: false, error: `${label} is required` };
  }

  if (!AMOUNT_REGEX.test(trimmed)) {
    return { ok: false, error: `${label} must be a numeric value` };
  }

  const [wholePartRaw, fractionRaw = ""] = trimmed.split(".");
  if (!wholePartRaw || !/^\d+$/.test(wholePartRaw)) {
    return { ok: false, error: `${label} whole part is invalid` };
  }

  if (decimals === 0 && fractionRaw.length > 0) {
    return {
      ok: false,
      error: `${label}: Fractional value is not allowed when decimals are 0`,
    };
  }
  if (fractionRaw.length > decimals) {
    return {
      ok: false,
      error: `${label}: Fractional precision exceeds decimals (${decimals})`,
    };
  }

  const paddedFraction = fractionRaw.padEnd(decimals, "0");
  const combined = `${wholePartRaw}${paddedFraction}`.replace(/^0+/, "") || "0";
  try {
    const baseUnits = BigInt(combined);
    if (!options?.allowZero && baseUnits === 0n) {
      return { ok: false, error: `${label} must be greater than zero` };
    }
    return { ok: true, baseUnits };
  } catch {
    return { ok: false, error: `${label} exceeds supported precision` };
  }
}

export function parseHumanAmountOrThrow(
  raw: string,
  decimals: number,
  label: string,
  options?: Omit<ParseAmountOptions, "label">,
): bigint {
  const parsed = parseHumanAmountToBaseUnits(raw, decimals, { ...options, label });
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.baseUnits;
}

export function formatBaseUnitsToDecimal(baseUnits: bigint, decimals: number): string {
  if (decimals <= 0) {
    return baseUnits.toString();
  }
  const divisor = pow10(decimals);
  const whole = baseUnits / divisor;
  const fraction = baseUnits % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionStr}`;
}
