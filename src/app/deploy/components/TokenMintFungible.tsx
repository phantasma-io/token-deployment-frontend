"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Address, EasyConnect, FeeOptions, Token } from "phantasma-sdk-ts";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import type { AddLogFn } from "../types";
import { getTokenPrimary } from "../utils/tokenHelpers";
import { getTokenExtended, mintFungible } from "@/lib/phantasmaClient";
import { formatBaseUnitsToDecimal, parseHumanAmountToBaseUnits, INTX_MAX_VALUE } from "../utils/decimalUnits";
import { parseBigIntInput } from "../utils/bigintInputs";
import { formatKcalAmount, formatSoulAmount } from "../utils/feeFormatting";

type PhaCtxMinimal = {
  conn?: EasyConnect | null;
};

type TokenSnapshot = {
  symbol: string;
  carbonId: bigint | null;
  decimals: number;
  currentSupply: bigint;
  maxSupply: bigint;
};

type TokenMintFungibleProps = {
  selectedToken: Token;
  phaCtx: PhaCtxMinimal;
  addLog: AddLogFn;
};

const FEE_DEFAULTS = {
  gasFeeBase: "10000",
  feeMultiplier: "1000",
  maxDataLimit: "100",
};

function toBigIntSafe(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function toCarbonId(value: string | number | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value as string | number | bigint);
  } catch {
    return null;
  }
}

function snapshotFromToken(token: Token | null): TokenSnapshot | null {
  if (!token) return null;
  const decimalsRaw = Number(token.decimals ?? 0);
  const decimals = Number.isFinite(decimalsRaw) && decimalsRaw > 0 ? Math.floor(decimalsRaw) : 0;
  return {
    symbol: token.symbol ?? "",
    carbonId: toCarbonId(token.carbonId),
    decimals,
    currentSupply: toBigIntSafe(token.currentSupply),
    maxSupply: toBigIntSafe(token.maxSupply),
  };
}

function formatLimit(baseUnits: bigint | null, decimals: number): string {
  if (baseUnits === null) {
    return "Unlimited";
  }
  return `${formatBaseUnitsToDecimal(baseUnits, decimals)} (${baseUnits.toString()} base units)`;
}

function isValidAddress(address: string): boolean {
  try {
    Address.FromText(address);
    return true;
  } catch {
    return false;
  }
}

export function TokenMintFungible({ selectedToken, phaCtx, addLog }: TokenMintFungibleProps) {
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(() => snapshotFromToken(selectedToken));
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotReloadToken, setSnapshotReloadToken] = useState(0);

  const [amountInput, setAmountInput] = useState("");
  const [targetAddress, setTargetAddress] = useState(
    phaCtx?.conn?.link?.account?.address ?? "",
  );
  const [amountError, setAmountError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [feesExpanded, setFeesExpanded] = useState(false);
  const [feesAreDefault, setFeesAreDefault] = useState(true);
  const [gasFeeBase, setGasFeeBase] = useState(FEE_DEFAULTS.gasFeeBase);
  const [feeMultiplier, setFeeMultiplier] = useState(FEE_DEFAULTS.feeMultiplier);
  const [maxDataLimit, setMaxDataLimit] = useState(FEE_DEFAULTS.maxDataLimit);

  const walletAddress = phaCtx?.conn?.link?.account?.address ?? "";
  const tokenPrimary = getTokenPrimary(selectedToken, selectedToken.symbol);

  useEffect(() => {
    setSnapshot(snapshotFromToken(selectedToken));
    setAmountInput("");
    setAmountError(null);
    setAddressError(null);
    setMintError(null);
    setTxHash(null);
    setGasFeeBase(FEE_DEFAULTS.gasFeeBase);
    setFeeMultiplier(FEE_DEFAULTS.feeMultiplier);
    setMaxDataLimit(FEE_DEFAULTS.maxDataLimit);
    setFeesExpanded(false);
    setFeesAreDefault(true);
  }, [selectedToken]);

  useEffect(() => {
    setTargetAddress(walletAddress ?? "");
  }, [walletAddress, selectedToken?.symbol]);

  useEffect(() => {
    let cancelled = false;
    const symbol = selectedToken?.symbol;
    if (!symbol) {
      setSnapshotError("Token symbol is missing");
      return;
    }
    setLoadingSnapshot(true);
    setSnapshotError(null);
    addLog("[mint] Loading token snapshot for fungible mint", { symbol });
    void getTokenExtended(symbol)
      .then((token) => {
        if (cancelled) return;
        setSnapshot(snapshotFromToken(token));
        addLog("[mint] Token snapshot refreshed", {
          symbol,
          decimals: token.decimals,
          carbonId: token.carbonId,
          currentSupply: token.currentSupply,
          maxSupply: token.maxSupply,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setSnapshotError(message);
        addLog("[error] Failed to load token snapshot", { symbol, error: message });
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingSnapshot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedToken?.symbol, snapshotReloadToken, addLog]);

  useEffect(() => {
    const defaults =
      gasFeeBase.trim() === FEE_DEFAULTS.gasFeeBase &&
      feeMultiplier.trim() === FEE_DEFAULTS.feeMultiplier &&
      maxDataLimit.trim() === FEE_DEFAULTS.maxDataLimit;
    setFeesAreDefault(defaults);
  }, [gasFeeBase, feeMultiplier, maxDataLimit]);

  const feeSummary = useMemo(() => {
    try {
      const gasFeeBaseValue = parseBigIntInput(gasFeeBase, "Gas fee base");
      const feeMultiplierValue = parseBigIntInput(feeMultiplier, "Fee multiplier");
      const maxDataValue = parseBigIntInput(maxDataLimit, "Max data limit", {
        allowEmpty: true,
        defaultValue: 0n,
      });
      const feeOptions = new FeeOptions(gasFeeBaseValue, feeMultiplierValue);
      const maxGasValue = feeOptions.calculateMaxGas();
      return { ok: true as const, maxGas: maxGasValue, maxData: maxDataValue };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid fee configuration";
      return { ok: false as const, error: message };
    }
  }, [gasFeeBase, feeMultiplier, maxDataLimit]);

  const decimals = snapshot?.decimals ?? 0;
  const carbonTokenId = snapshot?.carbonId ?? toCarbonId(selectedToken?.carbonId);
  const currentSupply = snapshot?.currentSupply ?? 0n;
  const maxSupply = snapshot?.maxSupply ?? 0n;
  const remainingCapacity =
    maxSupply === 0n
      ? null
      : maxSupply > currentSupply
        ? maxSupply - currentSupply
        : 0n;

  const amountParse = useMemo(
    () =>
      parseHumanAmountToBaseUnits(amountInput, decimals, {
        label: "Amount",
        allowZero: false,
      }),
    [amountInput, decimals],
  );
  const amountBaseUnits = amountParse.ok ? amountParse.baseUnits : null;

  useEffect(() => {
    if (amountParse.ok) {
      if (amountParse.baseUnits > INTX_MAX_VALUE) {
        setAmountError("Amount exceeds the maximum supported size");
      } else if (remainingCapacity !== null && amountParse.baseUnits > remainingCapacity) {
        setAmountError("Amount exceeds remaining mintable supply");
      } else {
        setAmountError(null);
      }
    } else {
      setAmountError(amountParse.error);
    }
  }, [amountParse, remainingCapacity]);

  useEffect(() => {
    const trimmed = targetAddress.trim();
    if (!trimmed) {
      setAddressError("Destination address is required");
      return;
    }
    if (!isValidAddress(trimmed)) {
      setAddressError("Destination address is invalid");
      return;
    }
    setAddressError(null);
  }, [targetAddress]);

  const baseUnitsDisplay = amountBaseUnits !== null ? amountBaseUnits.toString() : "—";
  const humanRemaining = formatLimit(remainingCapacity, decimals);
  const humanCurrent = `${formatBaseUnitsToDecimal(currentSupply, decimals)} (${currentSupply.toString()} base units)`;
  const humanMax =
    maxSupply === 0n
      ? "Unlimited"
      : `${formatBaseUnitsToDecimal(maxSupply, decimals)} (${maxSupply.toString()} base units)`;

  const canMint =
    !!phaCtx?.conn &&
    carbonTokenId !== null &&
    amountBaseUnits !== null &&
    amountBaseUnits > 0n &&
    !amountError &&
    !addressError &&
    !loadingSnapshot &&
    !minting;

  const handleMint = useCallback(async () => {
    if (!canMint || !phaCtx?.conn || carbonTokenId === null || amountBaseUnits === null) {
      return;
    }
    setMinting(true);
    setMintError(null);
    setTxHash(null);
    const destination = targetAddress.trim();
    let gasFeeBaseValue: bigint;
    let feeMultiplierValue: bigint;
    let maxDataValue: bigint;
    try {
      gasFeeBaseValue = parseBigIntInput(gasFeeBase, "Gas fee base");
      feeMultiplierValue = parseBigIntInput(feeMultiplier, "Fee multiplier");
      maxDataValue = parseBigIntInput(maxDataLimit, "Max data limit", { allowEmpty: true, defaultValue: 0n });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMintError(message);
      toast.error(message);
      setMinting(false);
      return;
    }
    const feeOptions = new FeeOptions(gasFeeBaseValue, feeMultiplierValue);
    addLog("[mint] Submitting fungible mint", {
      symbol: selectedToken.symbol,
      carbonTokenId: carbonTokenId.toString(),
      destination,
      amount_base_units: amountBaseUnits.toString(),
      fees: {
        gasFeeBase: gasFeeBaseValue.toString(),
        feeMultiplier: feeMultiplierValue.toString(),
        maxData: maxDataValue.toString(),
      },
    });
    try {
      const res = await mintFungible({
        conn: phaCtx.conn,
        carbonTokenId,
        destinationAddress: destination,
        amount: amountBaseUnits,
        feeOptions,
        maxData: maxDataValue,
        addLog,
      });
      if (!res.success) {
        throw new Error(res.error);
      }
      toast.success("Mint transaction submitted");
      setTxHash(res.txHash);
      addLog("[mint] Fungible mint accepted by network", {
        txHash: res.txHash,
        destination,
        amount: amountBaseUnits.toString(),
      });
      setSnapshotReloadToken((prev) => prev + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMintError(message);
      toast.error(message);
      addLog("[error] Fungible mint failed", { error: message });
    } finally {
      setMinting(false);
    }
  }, [
    canMint,
    phaCtx?.conn,
    carbonTokenId,
    amountBaseUnits,
    targetAddress,
    selectedToken.symbol,
    gasFeeBase,
    feeMultiplier,
    maxDataLimit,
    addLog,
  ]);

  const handleReset = useCallback(() => {
    setAmountInput("");
    setMintError(null);
    setTxHash(null);
    setAmountError(null);
    setGasFeeBase(FEE_DEFAULTS.gasFeeBase);
    setFeeMultiplier(FEE_DEFAULTS.feeMultiplier);
    setMaxDataLimit(FEE_DEFAULTS.maxDataLimit);
    setFeesExpanded(false);
    setFeesAreDefault(true);
  }, []);

  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a token to mint</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Choose a fungible token from the list to mint new supply.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Mint supply for <span className="font-mono">{tokenPrimary}</span>
        </CardTitle>
        <Button type="button" size="sm" variant="outline" onClick={handleReset} disabled={minting}>
          Reset
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingSnapshot ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading token data…
          </div>
        ) : snapshotError ? (
          <div className="text-sm text-red-600">{snapshotError}</div>
        ) : carbonTokenId === null ? (
          <div className="text-sm text-red-600">Carbon token ID is unavailable for this token.</div>
        ) : (
          <>
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">Decimals</span>
                <span>{decimals}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">Current supply</span>
                <span>{humanCurrent}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">Max supply</span>
                <span>{humanMax}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">Remaining capacity</span>
                <span>{humanRemaining}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Destination address</label>
              <input
                className="w-full rounded border px-3 py-2 font-mono text-sm"
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                placeholder="P..."
              />
              {addressError && <p className="text-xs text-red-600">{addressError}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Amount to mint{decimals === 0 ? " (base units)" : ""}
              </label>
              <input
                className="w-full rounded border px-3 py-2"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder={decimals > 0 ? "1234.56789" : "10000"}
              />
              <div className="text-xs text-muted-foreground">
                Base units: <span className="font-mono">{baseUnitsDisplay}</span>
              </div>
            {amountError && <p className="text-xs text-amber-500">{amountError}</p>}
          </div>

          <div className="rounded-lg border p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setFeesExpanded((prev) => !prev)}
            >
              <div className="flex items-center gap-2">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`h-4 w-4 transition-transform ${feesExpanded ? "rotate-180" : ""}`}
                >
                  <path
                    fillRule="evenodd"
                    d="M12 15.75a.75.75 0 0 1-.53-.22l-5-5a.75.75 0 1 1 1.06-1.06L12 13.94l4.47-4.47a.75.75 0 0 1 1.06 1.06l-5 5a.75.75 0 0 1-.53.22z"
                    clipRule="evenodd"
                  />
                </svg>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Fees &amp; limits
                </h3>
                {feesAreDefault && (
                  <span className="text-xs text-emerald-600">Using default fees</span>
                )}
              </div>
            </button>
            {feesExpanded ? (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Gas fee base</label>
                    <input
                      className="w-full rounded border px-2 py-1 font-mono"
                      value={gasFeeBase}
                      onChange={(e) => setGasFeeBase(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Fee multiplier</label>
                    <input
                      className="w-full rounded border px-2 py-1 font-mono"
                      value={feeMultiplier}
                      onChange={(e) => setFeeMultiplier(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Max data (SOUL)</label>
                    <input
                      className="w-full rounded border px-2 py-1 font-mono"
                      value={maxDataLimit}
                      onChange={(e) => setMaxDataLimit(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Default: {FEE_DEFAULTS.maxDataLimit}</p>
                  </div>
                </div>
                <div className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Estimated totals (max)</div>
                  {feeSummary.ok ? (
                    <div className="mt-1 space-y-1">
                      <div>
                        KCAL: <span className="font-mono">{formatKcalAmount(feeSummary.maxGas)}</span>
                      </div>
                      <div>
                        SOUL: <span className="font-mono">{formatSoulAmount(feeSummary.maxData)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-amber-500">{feeSummary.error}</div>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {feesAreDefault
                  ? "Using default Carbon gas fees and max data limit (100 SOUL)."
                  : "Custom fees will be applied to this transaction."}
              </p>
            )}
          </div>

            {mintError && <div className="text-sm text-red-600">{mintError}</div>}
            {txHash && (
              <div className="text-sm text-green-600 break-all">
                Transaction hash: <span className="font-mono">{txHash}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={handleMint} disabled={!canMint} className="flex items-center gap-2">
                {minting && <Loader2 className="h-4 w-4 animate-spin" />}
                Mint
              </Button>
              {!phaCtx?.conn && (
                <p className="text-xs text-muted-foreground">
                  Connect your wallet to mint additional supply.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
