"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreateSeriesFeeOptions,
  EasyConnect,
  Token,
  VmStructSchema,
  VmStructSchemaResult,
  VmType,
  seriesDefaultMetadataFields,
  standardMetadataFields,
  vmStructSchemaFromRpcResult,
} from "phantasma-sdk-ts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Rocket, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { getTokenPrimary, isTokenNFT } from "../utils/tokenHelpers";
import { isHexValueValid, isVmValueValid } from "../utils/vmValidation";
import { convertRoyaltiesPercent } from "../utils/royalties";
import { normalizeImageUrl } from "../utils/urlHelpers";
import { formatVmTypeLabel } from "../utils/vmTypeLabel";
import { parseBigIntInput } from "../utils/bigintInputs";
import { formatKcalAmount, formatSoulAmount } from "../utils/feeFormatting";

import type { AddLogFn } from "../types";
import { createSeries, getTokenExtended } from "@/lib/phantasmaClient";

type PhaCtxMinimal = {
  conn?: EasyConnect | null;
};

type TokenSeriesTabProps = {
  selectedToken: Token | null;
  phaCtx: PhaCtxMinimal;
  addLog: AddLogFn;
};

type SeriesField = { name: string; type: VmType };

const DEFAULT_SERIES_MAX_DATA = 100000000n;
const SERIES_FEE_DEFAULTS = {
  gasFeeBase: "10000",
  gasFeeCreateSeriesBase: "2500000000",
  feeMultiplier: "10000",
  maxDataLimit: DEFAULT_SERIES_MAX_DATA.toString(),
};

export function TokenSeriesTab({ selectedToken, phaCtx, addLog }: TokenSeriesTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carbonId, setCarbonId] = useState<bigint | null>(null);
  const [seriesFields, setSeriesFields] = useState<SeriesField[]>([]);
  const [seriesSchema, setSeriesSchema] = useState<VmStructSchema | null>(null);

  // Inputs for standard fields (only shown if present in schema)
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageURL, setImageURL] = useState("");
  const [infoURL, setInfoURL] = useState("");
  const [royaltiesPercent, setRoyaltiesPercent] = useState("");
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const [romHex, setRomHex] = useState("0x"); // use 0x to indicate empty ROM by default
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [feesExpanded, setFeesExpanded] = useState(false);
  const [feesAreDefault, setFeesAreDefault] = useState(true);
  const [gasFeeBase, setGasFeeBase] = useState(SERIES_FEE_DEFAULTS.gasFeeBase);
  const [gasFeeCreateSeriesBase, setGasFeeCreateSeriesBase] = useState(
    SERIES_FEE_DEFAULTS.gasFeeCreateSeriesBase,
  );
  const [feeMultiplier, setFeeMultiplier] = useState(SERIES_FEE_DEFAULTS.feeMultiplier);
  const [maxDataLimit, setMaxDataLimit] = useState(SERIES_FEE_DEFAULTS.maxDataLimit);

  const walletAddress = phaCtx?.conn?.link?.account?.address ?? null;
  const canSign = !!walletAddress && !!phaCtx?.conn;

  const tokenPrimary = selectedToken
    ? getTokenPrimary(selectedToken, selectedToken.symbol)
    : "";
  const imagePreviewUrl = useMemo(() => normalizeImageUrl(imageURL), [imageURL]);

  const isNft = isTokenNFT(selectedToken || undefined);

  const resetInputs = useCallback(() => {
    setName("");
    setDescription("");
    setImageURL("");
    setInfoURL("");
    setRoyaltiesPercent("");
    setRomHex("0x");
    setGasFeeBase(SERIES_FEE_DEFAULTS.gasFeeBase);
    setGasFeeCreateSeriesBase(SERIES_FEE_DEFAULTS.gasFeeCreateSeriesBase);
    setFeeMultiplier(SERIES_FEE_DEFAULTS.feeMultiplier);
    setMaxDataLimit(SERIES_FEE_DEFAULTS.maxDataLimit);
    setFeesExpanded(false);
    setFeesAreDefault(true);
    setExtraValues((prev) => {
      const cleared: Record<string, string> = {};
      for (const key of Object.keys(prev)) {
        cleared[key] = "";
      }
      return cleared;
    });
  }, []);

  const handleManualReset = useCallback(() => {
    resetInputs();
    setSubmitError(null);
    setTxHash(null);
    setSeriesId(null);
  }, [resetInputs]);

  useEffect(() => {
    setImagePreviewError(false);
  }, [imageURL]);

  useEffect(() => {
    const defaults =
      gasFeeBase.trim() === SERIES_FEE_DEFAULTS.gasFeeBase &&
      gasFeeCreateSeriesBase.trim() === SERIES_FEE_DEFAULTS.gasFeeCreateSeriesBase &&
      feeMultiplier.trim() === SERIES_FEE_DEFAULTS.feeMultiplier &&
      maxDataLimit.trim() === SERIES_FEE_DEFAULTS.maxDataLimit;
    setFeesAreDefault(defaults);
  }, [gasFeeBase, gasFeeCreateSeriesBase, feeMultiplier, maxDataLimit]);

  const feeSummary = useMemo(() => {
    try {
      const gasFeeBaseValue = parseBigIntInput(gasFeeBase, "Gas fee base");
      const gasFeeCreateSeriesBaseValue = parseBigIntInput(
        gasFeeCreateSeriesBase,
        "Gas fee create series base",
      );
      const feeMultiplierValue = parseBigIntInput(feeMultiplier, "Fee multiplier");
      const maxDataValue = parseBigIntInput(maxDataLimit, "Max data limit", {
        allowEmpty: true,
        defaultValue: DEFAULT_SERIES_MAX_DATA,
      });
      const feeOptions = new CreateSeriesFeeOptions(
        gasFeeBaseValue,
        gasFeeCreateSeriesBaseValue,
        feeMultiplierValue,
      );
      const maxGasValue = feeOptions.calculateMaxGas();
      return { ok: true as const, maxGas: maxGasValue, maxData: maxDataValue };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid fee configuration";
      return { ok: false as const, error: message };
    }
  }, [gasFeeBase, gasFeeCreateSeriesBase, feeMultiplier, maxDataLimit]);

  const loadTokenDetails = useCallback(async () => {
    if (!selectedToken?.symbol) return;
    setLoading(true);
    setError(null);
    try {
      const t: Token = await getTokenExtended(selectedToken.symbol);
      const tokenSchemas = t.tokenSchemas ?? null;
      const rawCarbonId = t.carbonId;
      if (typeof rawCarbonId !== "string" || !rawCarbonId.trim()) {
        addLog("[error] RPC response missing carbonId", { token: t });
        throw new Error("Carbon token id not available from RPC");
      }
      setCarbonId(BigInt(rawCarbonId.trim()));

      const rpcSeries: VmStructSchemaResult | undefined = tokenSchemas?.seriesMetadata;
      if (!rpcSeries) {
        throw new Error("SeriesMetadata schema not available for this token");
      }

      // Build SDK schema and retain field listing for UI rendering (exact names)
      const schema = vmStructSchemaFromRpcResult(rpcSeries);
      setSeriesSchema(schema);
      const schemaFields = schema.fields ?? [];
      const defaultNames = new Set(seriesDefaultMetadataFields.map((f: any) => f.name));
      const mapped: SeriesField[] = schemaFields
        .map((sf) => ({
          name: String(sf.name?.data ?? ""),
          type: sf.schema?.type as VmType,
        }))
        .filter((f) => !!f.name)
        .filter((f) => !defaultNames.has(f.name) || f.name === "rom"); // don't render _i/mode; rom handled separately

      setSeriesFields(mapped);
      // initialize extra values strictly per schema
      const initial: Record<string, string> = {};
      const standardNames = new Set(standardMetadataFields.map((f: any) => f.name));
      for (const sf of schemaFields) {
        const k = String(sf.name?.data ?? "");
        if (!k || k === "rom" || seriesDefaultMetadataFields.some((f: any) => f.name === k) || standardNames.has(k)) continue;
        initial[k] = "";
      }
      setExtraValues(initial);
      addLog("[series] Loaded token schemas and carbon id", { symbol: selectedToken.symbol, carbonId: rawCarbonId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addLog("[error] Failed to load extended token", { error: message });
    } finally {
      setLoading(false);
    }
  }, [selectedToken?.symbol, addLog]);

  useEffect(() => {
    setSeriesFields([]);
    setCarbonId(null);
    resetInputs();
    setError(null);
    if (selectedToken?.symbol && isNft) {
      void loadTokenDetails();
    }
  }, [selectedToken?.symbol, isNft, loadTokenDetails, resetInputs]);

  const visibleStandard = useMemo(() => {
    const has = (n: string) => seriesFields.some((f) => f.name === n);
    return {
      name: has("name"),
      description: has("description"),
      imageURL: has("imageURL"),
      infoURL: has("infoURL"),
      royalties: has("royalties"),
      rom: seriesFields.some((f) => f.name === "rom"),
    };
  }, [seriesFields]);

  const schemaFieldMap = useMemo(() => {
    const map = new Map<string, VmType>();
    const fields = seriesSchema?.fields ?? [];
    for (const field of fields) {
      const key = String(field?.name?.data ?? "");
      if (!key) continue;
      map.set(key, field?.schema?.type as VmType);
    }
    return map;
  }, [seriesSchema]);

  const royaltiesConversion = useMemo(() => convertRoyaltiesPercent(royaltiesPercent), [royaltiesPercent]);
  const royaltiesBaseUnitsString =
    royaltiesConversion.kind === "ok" ? royaltiesConversion.baseUnits.toString() : "";
  const seriesRoyaltiesInvalid =
    visibleStandard.royalties && royaltiesPercent.trim().length > 0 && royaltiesConversion.kind === "error";
  const seriesRomInvalid =
    visibleStandard.rom && romHex.trim().length > 0 && !isHexValueValid(romHex);

  const formValid = useMemo(() => {
    if (!canSign || !isNft || !selectedToken || !carbonId || !seriesSchema) return false;
    // All fields from schema (excluding id/mode) are required
    if (visibleStandard.name && !name.trim()) return false;
    if (visibleStandard.description && !description.trim()) return false;
    if (visibleStandard.imageURL && !imageURL.trim()) return false;
    if (visibleStandard.infoURL && !infoURL.trim()) return false;
    if (visibleStandard.royalties && royaltiesConversion.kind !== "ok") return false;
    // All custom fields must be non-empty
    if (visibleStandard.rom && !isHexValueValid(romHex)) return false;

    const fields = seriesSchema.fields ?? [];
    for (const field of fields) {
      const key = String(field?.name?.data ?? "");
      if (!key || key === "_i" || key === "mode" || key === "rom") continue;
      let raw = "";
      switch (key) {
        case "name":
          raw = name;
          break;
        case "description":
          raw = description;
          break;
        case "imageURL":
          raw = imageURL;
          break;
        case "infoURL":
          raw = infoURL;
          break;
        case "royalties":
          raw = royaltiesBaseUnitsString;
          break;
        default:
          raw = extraValues[key] ?? "";
          break;
      }
      if (!raw || !raw.trim()) return false;
      const vmType = schemaFieldMap.get(key);
      if (vmType !== undefined && !isVmValueValid(vmType, raw.trim())) return false;
    }
    return true;
  }, [
    canSign,
    isNft,
    selectedToken,
    carbonId,
    seriesSchema,
    visibleStandard,
    name,
    description,
    imageURL,
    infoURL,
    royaltiesConversion,
    royaltiesBaseUnitsString,
    romHex,
    extraValues,
    schemaFieldMap,
  ]);

  const handleCreate = useCallback(async () => {
    if (!selectedToken?.symbol || !carbonId) return;
    if (!phaCtx?.conn) {
      setSubmitError("Wallet is not connected");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setTxHash(null);
    setSeriesId(null);

    try {
      // Use schema captured during load to avoid any drift
      const schema: VmStructSchema = seriesSchema ?? (() => {
        // Fallback: rebuild once if state missing
        throw new Error("Series schema not loaded");
      })();

      // Build values by iterating exact SDK schema and reading UI state (case-sensitive keys)
      const values: Record<string, string> = {};
      for (const sf of (schema.fields ?? [])) {
        const k = String(sf.name?.data ?? '');
        if (!k) continue;
        if (k === '_i' || k === 'mode' || k === 'rom') continue;
        let v = '';
        switch (k) {
          case 'name': v = name.trim(); break;
          case 'description': v = description.trim(); break;
          case 'imageURL': v = imageURL.trim(); break;
          case 'infoURL': v = infoURL.trim(); break;
          case 'royalties': v = royaltiesBaseUnitsString || ""; break;
          default:
            v = (extraValues[k] ?? '').trim();
            break;
        }
        values[k] = v;
      }

      let gasFeeBaseValue: bigint;
      let gasFeeCreateSeriesBaseValue: bigint;
      let feeMultiplierValue: bigint;
      let maxDataValue: bigint;
      try {
        gasFeeBaseValue = parseBigIntInput(gasFeeBase, "Gas fee base");
        gasFeeCreateSeriesBaseValue = parseBigIntInput(
          gasFeeCreateSeriesBase,
          "Gas fee create series base",
        );
        feeMultiplierValue = parseBigIntInput(feeMultiplier, "Fee multiplier");
        maxDataValue = parseBigIntInput(maxDataLimit, "Max data limit", {
          allowEmpty: true,
          defaultValue: DEFAULT_SERIES_MAX_DATA,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setSubmitError(message);
        addLog("[error] Series fee parsing failed", { error: message });
        return;
      }

      const feeOptions = new CreateSeriesFeeOptions(
        gasFeeBaseValue,
        gasFeeCreateSeriesBaseValue,
        feeMultiplierValue,
      );

      addLog('[series] Debug series payload', {
        schemaKeys: (schema.fields ?? []).map((f) => f.name?.data),
        valuesKeys: Object.keys(values),
        extras: extraValues,
        fees: {
          gasFeeBase: gasFeeBaseValue.toString(),
          gasFeeCreateSeriesBase: gasFeeCreateSeriesBaseValue.toString(),
          feeMultiplier: feeMultiplierValue.toString(),
          maxData: maxDataValue.toString(),
        },
      });

      const res = await createSeries({
        conn: phaCtx.conn as EasyConnect,
        carbonTokenId: carbonId,
        seriesSchema: schema,
        seriesValues: values,
        romHex: visibleStandard.rom ? romHex.trim() : undefined,
        feeOptions,
        maxData: maxDataValue,
        addLog,
      });

      if (!res.success) {
        throw new Error(res.error);
      }
      setTxHash(res.txHash);
      if (res.seriesId !== undefined) setSeriesId(res.seriesId);
      addLog("[series] Created series", { txHash: res.txHash, seriesId: res.seriesId });
      resetInputs();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setSubmitError(message);
      addLog("[error] Failed to create series", { error: message });
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedToken?.symbol,
    carbonId,
    phaCtx?.conn,
    visibleStandard,
    name,
    description,
    imageURL,
    infoURL,
    royaltiesPercent,
    royaltiesBaseUnitsString,
    romHex,
    gasFeeBase,
    gasFeeCreateSeriesBase,
    feeMultiplier,
    maxDataLimit,
    addLog,
    seriesSchema,
    extraValues,
    resetInputs,
  ]);

  if (!selectedToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a token to manage series</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Use the token list to choose the NFT token.</p>
          <p>Series configuration UI will appear here once a token is selected.</p>
        </CardContent>
      </Card>
    );
  }

  if (!isNft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            Selected token <span className="font-mono">{tokenPrimary}</span> is fungible
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Series are supported only for NFT tokens. Please select an NFT.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>
          Create series for <span className="font-mono">{tokenPrimary}</span>
        </CardTitle>
        <Button type="button" size="sm" variant="outline" onClick={handleManualReset} disabled={loading || submitting}>
          Reset
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading token schemas…
          </div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleStandard.name && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">
                    Name <span className="text-red-500">*</span>
                  </div>
                  <input
                    className="w-full rounded border px-2 py-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}
              {visibleStandard.imageURL && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">
                    Image URL <span className="text-red-500">*</span>
                  </div>
                  <input
                    className="w-full rounded border px-2 py-1"
                    value={imageURL}
                    onChange={(e) => setImageURL(e.target.value)}
                    required
                  />
                  {imagePreviewUrl && (
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Preview</div>
                      <div className="flex h-32 items-center justify-center rounded border bg-muted/30 p-2">
                        {imagePreviewError ? (
                          <span className="text-xs text-muted-foreground">Failed to load preview</span>
                        ) : (
                          <img
                            src={imagePreviewUrl}
                            alt="Series preview"
                            className="max-h-28 object-contain"
                            onError={() => setImagePreviewError(true)}
                            onLoad={() => setImagePreviewError(false)}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {visibleStandard.infoURL && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">
                    Info URL <span className="text-red-500">*</span>
                  </div>
                  <input
                    className="w-full rounded border px-2 py-1"
                    value={infoURL}
                    onChange={(e) => setInfoURL(e.target.value)}
                    required
                  />
                </div>
              )}
              {visibleStandard.royalties && (
                <div className="space-y-1">
                  <div className="text-xs font-medium flex items-center justify-between gap-2">
                    <span>
                      Royalties (%) <span className="text-red-500">*</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground">1% = 10,000,000 base units</span>
                  </div>
                  <input
                    className={`w-full rounded border px-2 py-1${seriesRoyaltiesInvalid ? " border-red-500 focus-visible:ring-red-500" : ""}`}
                    inputMode="decimal"
                    value={royaltiesPercent}
                    onChange={(e) => setRoyaltiesPercent(e.target.value)}
                    placeholder="e.g. 2.5"
                    required
                  />
                  {royaltiesConversion.kind === "error" ? (
                    <p className="text-xs text-amber-500">{royaltiesConversion.message}</p>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Base units:</span>
                      <span className="font-mono">
                        {royaltiesConversion.kind === "ok" ? royaltiesBaseUnitsString : "—"}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {visibleStandard.description && (
                <div className="space-y-1 sm:col-span-2">
                  <div className="text-xs font-medium">
                    Description <span className="text-red-500">*</span>
                  </div>
                  <textarea
                    className="w-full rounded border px-2 py-1"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </div>
              )}
              {/* Render custom fields */}
              {seriesFields.map((f) => {
                const k = f.name;
                if (["_i", "mode", "rom", "name", "description", "imageURL", "infoURL", "royalties"].includes(k)) {
                  return null;
                }
                const rawValue = extraValues[k] ?? "";
                const trimmedValue = rawValue.trim();
                const vmInvalid = trimmedValue.length > 0 && !isVmValueValid(f.type, trimmedValue);
                return (
                  <div key={k} className="space-y-1">
                    <div className="text-xs font-medium flex items-center gap-2">
                      <span>
                        {k} <span className="text-red-500">*</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatVmTypeLabel(f.type)}
                      </span>
                    </div>
                    <input
                      className={`w-full rounded border px-2 py-1${vmInvalid ? " border-red-500 focus-visible:ring-red-500" : ""}`}
                      value={rawValue}
                      onChange={(e) => setExtraValues((prev) => ({ ...prev, [k]: e.target.value }))}
                      required
                    />
                  </div>
                );
              })}
              {visibleStandard.rom && (
                <div className="space-y-1 sm:col-span-2">
                  <div className="text-xs font-medium">ROM (hex)
                    <span className="text-muted-foreground"> — use 0x for empty</span>
                  </div>
                  <input
                    className={`w-full rounded border px-2 py-1 font-mono${seriesRomInvalid ? " border-red-500 focus-visible:ring-red-500" : ""}`}
                    value={romHex}
                    onChange={(e) => setRomHex(e.target.value)}
                    placeholder="0x…"
                    required
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setFeesExpanded((prev) => !prev)}
                aria-expanded={feesExpanded}
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
                      <label className="block text-sm font-medium mb-1">Gas fee (create series base)</label>
                      <input
                        className="w-full rounded border px-2 py-1 font-mono"
                        value={gasFeeCreateSeriesBase}
                        onChange={(e) => setGasFeeCreateSeriesBase(e.target.value)}
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
                    <div className="md:col-span-3">
                      <label className="block text-sm font-medium mb-1">Max data (SOUL)</label>
                      <input
                        className="w-full rounded border px-2 py-1 font-mono"
                        value={maxDataLimit}
                        onChange={(e) => setMaxDataLimit(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Default: {SERIES_FEE_DEFAULTS.maxDataLimit}
                      </p>
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
                    ? "Using default Carbon gas fees and max data limit."
                    : "Custom fees will be applied to this series creation."}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" onClick={handleCreate} disabled={!formValid || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" /> Create Series
                  </>
                )}
              </Button>
              {!canSign && (
                <span className="text-xs text-muted-foreground">Connect wallet to continue</span>
              )}
            </div>

            <div className="w-full space-y-2 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Series creation status</div>
              {!submitting && !submitError && !txHash && (
                <div>No recent series creation.</div>
              )}
              {submitting && (
                <div className="flex items-center gap-2 text-amber-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for transaction confirmation…
                </div>
              )}
              {!submitting && !submitError && txHash && (
                <div className="space-y-1">
                  <div className="text-emerald-600 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Transaction confirmed
                    {typeof seriesId === "number" && (
                      <span className="text-xs text-muted-foreground">
                        (Series ID: {seriesId})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs break-all">{txHash}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(txHash)
                          .then(() => toast.success("Hash copied"))
                          .catch(() => toast.error("Copy failed"));
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              )}
              {!submitting && submitError && (
                <div className="space-y-1 text-destructive">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Transaction failed: {submitError}
                  </div>
                  {txHash && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-mono text-xs break-all">{txHash}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(txHash)
                            .then(() => toast.success("Hash copied"))
                            .catch(() => toast.error("Copy failed"));
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
