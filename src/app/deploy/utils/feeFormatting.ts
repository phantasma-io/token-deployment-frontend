import { DomainSettings } from "phantasma-sdk-ts";

import { formatBaseUnitsToDecimal } from "./decimalUnits";

const GROUPING_REGEX = /\B(?=(\d{3})+(?!\d))/g;

function formatBaseUnits(baseUnits: bigint): string {
  return baseUnits.toString().replace(GROUPING_REGEX, ",");
}

function formatTokenAmount(baseUnits: bigint, decimals: number): string {
  const human = formatBaseUnitsToDecimal(baseUnits, decimals);
  const baseLabel = formatBaseUnits(baseUnits);
  if (decimals <= 0) {
    return baseLabel;
  }
  return `${human} (${baseLabel} base units)`;
}

export function formatKcalAmount(baseUnits: bigint): string {
  return formatTokenAmount(baseUnits, DomainSettings.FuelTokenDecimals);
}

export function formatSoulAmount(baseUnits: bigint): string {
  return formatTokenAmount(baseUnits, DomainSettings.StakingTokenDecimals);
}
