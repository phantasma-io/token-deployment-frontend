export function parseBigIntInput(
  raw: string,
  label: string,
  opts?: { allowEmpty?: boolean; defaultValue?: bigint },
): bigint {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (opts?.allowEmpty) {
      return opts?.defaultValue ?? 0n;
    }
    throw new Error(`${label} is required`);
  }
  let value: bigint;
  try {
    value = BigInt(trimmed);
  } catch {
    throw new Error(`${label} must be a valid integer`);
  }
  if (value < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
}
