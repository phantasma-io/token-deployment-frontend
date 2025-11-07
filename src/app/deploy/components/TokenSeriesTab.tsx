"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Token, EasyConnect, VmStructSchema, standardMetadataFields, seriesDefaultMetadataFields, VmStructSchemaResult, vmStructSchemaFromRpcResult, VmType } from "phantasma-sdk-ts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Rocket, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { getTokenPrimary, isTokenNFT } from "../utils/tokenHelpers";
import { isHexValueValid, isVmValueValid } from "../utils/vmValidation";
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

type SeriesField = { name: string; type: string | number };

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
  const [royalties, setRoyalties] = useState("");
  const [romHex, setRomHex] = useState("0x"); // use 0x to indicate empty ROM by default
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const walletAddress = phaCtx?.conn?.link?.account?.address ?? null;
  const canSign = !!walletAddress && !!phaCtx?.conn;

  const tokenPrimary = selectedToken
    ? getTokenPrimary(selectedToken, selectedToken.symbol)
    : "";

  const isNft = isTokenNFT(selectedToken || undefined);

  const resetInputs = useCallback(() => {
    setName("");
    setDescription("");
    setImageURL("");
    setInfoURL("");
    setRoyalties("");
    setRomHex("0x");
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

  const loadTokenDetails = useCallback(async () => {
    if (!selectedToken?.symbol) return;
    setLoading(true);
    setError(null);
    try {
      const t: Token = await getTokenExtended(selectedToken.symbol);
      const tokenSchemas = t.tokenSchemas ?? null;
      const cId = t.carbonId ?? null;
      if (cId == null) {
        addLog("[error] RPC response missing carbonId", { token: t });
        throw new Error("Carbon token id not available from RPC");
      }
      setCarbonId(BigInt(cId));

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
        .map((sf) => ({ name: String(sf.name?.data ?? ""), type: (sf.schema?.type as any) }))
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
      addLog("[series] Loaded token schemas and carbon id", { symbol: selectedToken.symbol, carbonId: String(cId) });
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

  const formValid = useMemo(() => {
    if (!canSign || !isNft || !selectedToken || !carbonId || !seriesSchema) return false;
    // All fields from schema (excluding id/mode) are required
    if (visibleStandard.name && !name.trim()) return false;
    if (visibleStandard.description && !description.trim()) return false;
    if (visibleStandard.imageURL && !imageURL.trim()) return false;
    if (visibleStandard.infoURL && !infoURL.trim()) return false;
    if (visibleStandard.royalties) {
      if (!/^[-]?\d+$/.test(royalties.trim())) return false;
    }
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
          raw = royalties;
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
    royalties,
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
          case 'royalties': v = royalties.trim(); break;
          default:
            v = (extraValues[k] ?? '').trim();
            break;
        }
        values[k] = v;
      }

      addLog('[series] Debug series payload', {
        schemaKeys: (schema.fields ?? []).map((f) => f.name?.data),
        valuesKeys: Object.keys(values),
        extras: extraValues,
      });

      const res = await createSeries({
        conn: phaCtx.conn as EasyConnect,
        carbonTokenId: carbonId,
        seriesSchema: schema,
        seriesValues: values,
        romHex: visibleStandard.rom ? romHex.trim() : undefined,
        maxData: 100000000n,
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
  }, [selectedToken?.symbol, carbonId, phaCtx?.conn, visibleStandard, name, description, imageURL, infoURL, royalties, romHex, addLog, seriesSchema, extraValues, resetInputs]);

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
                  <div className="text-xs font-medium">Name</div>
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
                  <div className="text-xs font-medium">Image URL</div>
                  <input
                    className="w-full rounded border px-2 py-1"
                    value={imageURL}
                    onChange={(e) => setImageURL(e.target.value)}
                    required
                  />
                </div>
              )}
              {visibleStandard.infoURL && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Info URL</div>
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
                  <div className="text-xs font-medium">Royalties (Int32; 10000000 = 1%)</div>
                  <input
                    className="w-full rounded border px-2 py-1"
                    inputMode="numeric"
                    value={royalties}
                    onChange={(e) => setRoyalties(e.target.value)}
                    required
                  />
                </div>
              )}
              {visibleStandard.description && (
                <div className="space-y-1 sm:col-span-2">
                  <div className="text-xs font-medium">Description</div>
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
                return (
                  <div key={k} className="space-y-1">
                    <div className="text-xs font-medium flex items-center gap-2">
                      <span>{k}</span>
                      <span className="text-[10px] text-muted-foreground">{String(f.type)}</span>
                    </div>
                    <input
                      className="w-full rounded border px-2 py-1"
                      value={extraValues[k] ?? ""}
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
                    className="w-full rounded border px-2 py-1 font-mono"
                    value={romHex}
                    onChange={(e) => setRomHex(e.target.value)}
                    placeholder="0x…"
                    required
                  />
                </div>
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
