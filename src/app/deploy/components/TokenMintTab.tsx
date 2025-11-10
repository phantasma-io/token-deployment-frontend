"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Token,
  EasyConnect,
  VmStructSchema,
  VmStructSchemaResult,
  vmStructSchemaFromRpcResult,
  standardMetadataFields,
  nftDefaultMetadataFields,
  VmType,
  NFT,
} from "phantasma-sdk-ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Sparkles, CheckCircle2, XCircle, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { getTokenPrimary, isTokenNFT } from "../utils/tokenHelpers";
import { getNftId, truncateMiddle } from "../utils/nftHelpers";
import { isHexValueValid, isVmValueValid } from "../utils/vmValidation";
import { convertRoyaltiesPercent, type RoyaltiesConversion } from "../utils/royalties";
import { normalizeImageUrl } from "../utils/urlHelpers";
import { formatVmTypeLabel } from "../utils/vmTypeLabel";
import type { AddLogFn } from "../types";
import {
  getTokenExtended,
  listTokenSeries,
  listTokenNfts,
  mintNft,
  type TokenSeriesListItem,
} from "@/lib/phantasmaClient";
import { NftPreviewCard } from "./NftPreviewCard";

type PhaCtxMinimal = {
  conn?: EasyConnect | null;
};

type TokenMintTabProps = {
  selectedToken: Token | null;
  phaCtx: PhaCtxMinimal;
  addLog: AddLogFn;
};

type RomField = { name: string; type: VmType };

const DEFAULT_ROM_HEX = "0x";
const DEFAULT_MAX_DATA = 100000000n;
const NFT_PAGE_SIZE = 10;

export function TokenMintTab({ selectedToken, phaCtx, addLog }: TokenMintTabProps) {
  const [loadingToken, setLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [carbonId, setCarbonId] = useState<bigint | null>(null);
  const [romSchema, setRomSchema] = useState<VmStructSchema | null>(null);
  const [romFields, setRomFields] = useState<RomField[]>([]);
  const [ramSchema, setRamSchema] = useState<VmStructSchema | null>(null);
  const [ramFields, setRamFields] = useState<RomField[]>([]);

  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<TokenSeriesListItem[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageURL, setImageURL] = useState("");
  const [infoURL, setInfoURL] = useState("");
  const [royaltiesPercent, setRoyaltiesPercent] = useState("");
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const [romHex, setRomHex] = useState(DEFAULT_ROM_HEX);
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [ramValues, setRamValues] = useState<Record<string, string>>({});
  const imagePreviewUrl = useMemo(() => normalizeImageUrl(imageURL), [imageURL]);

  const [submitting, setSubmitting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [mintedAddresses, setMintedAddresses] = useState<string[] | null>(null);
  const [phantasmaNftId, setPhantasmaNftId] = useState<string | null>(null);
  const [seriesNfts, setSeriesNfts] = useState<NFT[]>([]);
  const [nftLoading, setNftLoading] = useState(false);
  const [nftError, setNftError] = useState<string | null>(null);
  const [nftNextCursor, setNftNextCursor] = useState<string | null>(null);
  const [nftCursorHistory, setNftCursorHistory] = useState<string[]>([""]);
  const [nftPageIndex, setNftPageIndex] = useState(0);

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
    setRoyaltiesPercent("");
    setRomHex(DEFAULT_ROM_HEX);
    setExtraValues((prev) => {
      const cleared: Record<string, string> = {};
      for (const key of Object.keys(prev)) {
        cleared[key] = "";
      }
      return cleared;
    });
    setRamValues((prev) => {
      const cleared: Record<string, string> = {};
      for (const key of Object.keys(prev)) {
        cleared[key] = "";
      }
      return cleared;
    });
  }, []);

  const resetNftListing = useCallback(() => {
    setSeriesNfts([]);
    setNftLoading(false);
    setNftError(null);
    setNftNextCursor(null);
    setNftCursorHistory([""]);
    setNftPageIndex(0);
  }, []);

  const handleManualReset = useCallback(() => {
    resetInputs();
    setMintError(null);
    setTxHash(null);
    setMintedAddresses(null);
    setPhantasmaNftId(null);
    resetNftListing();
  }, [resetInputs, resetNftListing]);

  useEffect(() => {
    setImagePreviewError(false);
  }, [imageURL]);

  const loadTokenDetails = useCallback(async () => {
    if (!selectedToken?.symbol) return;
    setLoadingToken(true);
    setTokenError(null);
    try {
      const token = await getTokenExtended(selectedToken.symbol);
      const schemas = token.tokenSchemas ?? null;
      const rawCarbonId = token.carbonId;
      if (typeof rawCarbonId !== "string" || !rawCarbonId.trim()) {
        addLog("[error] RPC response missing carbonId", { token: selectedToken.symbol });
        throw new Error("Carbon token id not available from RPC");
      }
      setCarbonId(BigInt(rawCarbonId.trim()));

      const romResult: VmStructSchemaResult | undefined = schemas?.rom;
      if (!romResult) {
        throw new Error("ROM schema not available for this token");
      }

      const schema = vmStructSchemaFromRpcResult(romResult);
      setRomSchema(schema);
      const schemaFields = schema.fields ?? [];
      const defaultNames = new Set(nftDefaultMetadataFields.map((f: any) => f.name));
      const mapped: RomField[] = schemaFields
        .map((sf) => ({
          name: String(sf.name?.data ?? ""),
          type: sf.schema?.type as VmType,
        }))
        .filter((f) => !!f.name)
        .filter((f) => !defaultNames.has(f.name) || f.name === "rom");
      setRomFields(mapped);

      const standardNames = new Set(standardMetadataFields.map((f: any) => f.name));
      const initialExtras: Record<string, string> = {};
      for (const sf of schemaFields) {
        const key = String(sf.name?.data ?? "");
        if (!key || key === "rom" || key === "id" || key === "_i") continue;
        if (standardNames.has(key)) continue;
        initialExtras[key] = "";
      }
      setExtraValues(initialExtras);

      const ramResult: VmStructSchemaResult | undefined = schemas?.ram;
      if (ramResult && Array.isArray(ramResult.fields) && ramResult.fields.length > 0) {
        const parsedRamSchema = vmStructSchemaFromRpcResult(ramResult);
        const ramSchemaFields = parsedRamSchema.fields ?? [];
        const mappedRam: RomField[] = ramSchemaFields
          .map((sf) => ({
            name: String(sf.name?.data ?? ""),
            type: sf.schema?.type as VmType,
          }))
          .filter((f) => !!f.name);
        setRamSchema(ramSchemaFields.length > 0 ? parsedRamSchema : null);
        setRamFields(mappedRam);
        const initialRamValues: Record<string, string> = {};
        mappedRam.forEach((f) => {
          initialRamValues[f.name] = "";
        });
        setRamValues(initialRamValues);
      } else {
        setRamSchema(null);
        setRamFields([]);
        setRamValues({});
      }

      addLog("[mint] Loaded token ROM schema", {
        symbol: selectedToken.symbol,
        carbonId: rawCarbonId,
        fieldCount: schemaFields.length,
        ramFieldCount: ramResult?.fields?.length ?? 0,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTokenError(message);
      setRomSchema(null);
      setRomFields([]);
      setRamSchema(null);
      setRamFields([]);
      setRamValues({});
      setCarbonId(null);
      addLog("[error] Failed to load token ROM schema", { error: message });
    } finally {
      setLoadingToken(false);
    }
  }, [selectedToken?.symbol, addLog]);

  const loadSeries = useCallback(
    async (symbol: string, cId: bigint) => {
      setSeriesLoading(true);
      setSeriesError(null);
      try {
        const list = await listTokenSeries(symbol, cId);
        setSeriesList(list);
        setSelectedSeriesId((prev) => {
          if (prev !== null && list.some((entry) => entry.carbonSeriesId === prev)) {
            return prev;
          }
          return list.length > 0 ? list[0].carbonSeriesId : null;
        });
        addLog("[mint] Loaded series options", { symbol, count: list.length });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setSeriesError(message);
        setSeriesList([]);
        setSelectedSeriesId(null);
        addLog("[error] Failed to load series list", { error: message });
      } finally {
        setSeriesLoading(false);
      }
    },
    [addLog],
  );

  const loadSeriesNfts = useCallback(
    async (
      cursor: string,
      opts?: { reset?: boolean; pageIndex?: number; preserveHistory?: boolean },
    ) => {
      if (!selectedSeriesId || !carbonId) return;
      setNftLoading(true);
      setNftError(null);
      try {
        const res = await listTokenNfts({
          carbonTokenId: carbonId,
          carbonSeriesId: selectedSeriesId,
          cursor,
          pageSize: NFT_PAGE_SIZE,
          extended: true,
        });
        setSeriesNfts(res.items);
        setNftNextCursor(res.nextCursor);
        if (opts?.reset) {
          setNftCursorHistory([cursor]);
          setNftPageIndex(0);
        } else if (opts?.pageIndex !== undefined) {
          const pageIndex = opts.pageIndex;
          setNftPageIndex(pageIndex);
          if (!opts.preserveHistory) {
            setNftCursorHistory((prev) => {
              const next = prev.slice(0, pageIndex + 1);
              next[pageIndex] = cursor;
              return next;
            });
          }
        }
        addLog("[mint] Loaded series NFTs", {
          cursor,
          count: res.items.length,
          nextCursor: res.nextCursor,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setSeriesNfts([]);
        setNftNextCursor(null);
        setNftError(message);
        addLog("[error] Failed to load NFTs for series", { error: message });
      } finally {
        setNftLoading(false);
      }
    },
    [selectedSeriesId, carbonId, addLog],
  );

  useEffect(() => {
    setRomSchema(null);
    setRomFields([]);
    setRamSchema(null);
    setRamFields([]);
    setRamValues({});
    setCarbonId(null);
    setSeriesList([]);
    setSelectedSeriesId(null);
    setTokenError(null);
    setSeriesError(null);
    setMintError(null);
    setTxHash(null);
    setMintedAddresses(null);
    setPhantasmaNftId(null);
    resetInputs();
    resetNftListing();

    if (selectedToken?.symbol && isNft) {
      void loadTokenDetails();
    }
  }, [selectedToken?.symbol, isNft, loadTokenDetails, resetInputs, resetNftListing]);

  useEffect(() => {
    if (selectedToken?.symbol && isNft && carbonId != null) {
      void loadSeries(selectedToken.symbol, carbonId);
    } else {
      setSeriesList([]);
      setSelectedSeriesId(null);
    }
  }, [selectedToken?.symbol, isNft, carbonId, loadSeries]);

  useEffect(() => {
    resetNftListing();
    if (carbonId != null && selectedSeriesId != null) {
      void loadSeriesNfts("", { reset: true });
    }
  }, [carbonId, selectedSeriesId, loadSeriesNfts, resetNftListing]);

  const visibleStandard = useMemo(() => {
    const has = (field: string) => romFields.some((f) => f.name === field);
    return {
      name: has("name"),
      description: has("description"),
      imageURL: has("imageURL"),
      infoURL: has("infoURL"),
      royalties: has("royalties"),
      rom: romFields.some((f) => f.name === "rom"),
    };
  }, [romFields]);

  const schemaFieldMap = useMemo(() => {
    const map = new Map<string, VmType>();
    const fields = romSchema?.fields ?? [];
    for (const field of fields) {
      const key = String(field?.name?.data ?? "");
      if (!key) continue;
      map.set(key, field?.schema?.type as VmType);
    }
    return map;
  }, [romSchema]);

  const royaltiesConversion = useMemo(() => convertRoyaltiesPercent(royaltiesPercent), [royaltiesPercent]);
  const royaltiesBaseUnitsString =
    royaltiesConversion.kind === "ok" ? royaltiesConversion.baseUnits.toString() : "";
  const royaltiesInvalid =
    visibleStandard.royalties && royaltiesPercent.trim().length > 0 && royaltiesConversion.kind === "error";
  const romHexInvalid =
    visibleStandard.rom && romHex.trim().length > 0 && !isHexValueValid(romHex);

  const formValid = useMemo(() => {
    if (!canSign || !isNft || !selectedToken || !carbonId || !romSchema || !selectedSeriesId) {
      return false;
    }
    if (visibleStandard.name && !name.trim()) return false;
    if (visibleStandard.description && !description.trim()) return false;
    if (visibleStandard.imageURL && !imageURL.trim()) return false;
    if (visibleStandard.infoURL && !infoURL.trim()) return false;
    if (visibleStandard.royalties && royaltiesConversion.kind !== "ok") return false;

    if (visibleStandard.rom) {
      if (!isHexValueValid(romHex)) return false;
    }

    const fields = romSchema.fields ?? [];
    for (const field of fields) {
      const key = String(field?.name?.data ?? "");
      if (!key || key === "rom" || key === "id" || key === "_i") continue;
      const vmType = schemaFieldMap.get(key);
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
      if (vmType !== undefined && !isVmValueValid(vmType, raw.trim())) {
        return false;
      }
    }
    const shouldValidateRam = ramSchema && ramFields.length > 0;
    if (shouldValidateRam) {
      for (const field of ramFields) {
        const key = field.name;
        if (!key) continue;
        const raw = ramValues[key] ?? "";
        const trimmed = raw.trim();
        if (!trimmed) return false;
        if (!isVmValueValid(field.type as VmType, trimmed)) {
          return false;
        }
      }
    }
    return true;
  }, [
    canSign,
    isNft,
    selectedToken,
    carbonId,
    romSchema,
    selectedSeriesId,
    visibleStandard,
    name,
    description,
    imageURL,
    infoURL,
    royaltiesPercent,
    royaltiesBaseUnitsString,
    royaltiesConversion,
    romHex,
    extraValues,
    schemaFieldMap,
    ramSchema,
    ramFields,
    ramValues,
  ]);

  const handleMint = useCallback(async () => {
    if (!phaCtx?.conn || !selectedToken?.symbol || !carbonId || !selectedSeriesId || !romSchema) {
      return;
    }
    setSubmitting(true);
    setMintError(null);
    setTxHash(null);
    setMintedAddresses(null);
    setPhantasmaNftId(null);

    try {
      const metadata: Record<string, string> = {};
      const fields = romSchema.fields ?? [];
      for (const field of fields) {
        const key = String(field?.name?.data ?? "");
        if (!key || key === "rom" || key === "id" || key === "_i") continue;
        let value = "";
        switch (key) {
          case "name":
            value = name.trim();
            break;
          case "description":
            value = description.trim();
            break;
          case "imageURL":
            value = imageURL.trim();
            break;
        case "infoURL":
          value = infoURL.trim();
          break;
        case "royalties":
          value = royaltiesBaseUnitsString || "";
          break;
          default:
            value = (extraValues[key] ?? "").trim();
            break;
        }
        metadata[key] = value;
      }

      const shouldSendRam = !!(ramSchema && ramFields.length > 0);
      const ramInputValues: Record<string, string> = {};
      if (shouldSendRam && ramSchema?.fields) {
        for (const field of ramSchema.fields) {
          const key = String(field?.name?.data ?? "");
          if (!key) continue;
          ramInputValues[key] = (ramValues[key] ?? "").trim();
        }
      }

      addLog("[mint] Submitting mint request", {
        symbol: selectedToken.symbol,
        carbonTokenId: String(carbonId),
        seriesId: selectedSeriesId,
        metadataKeys: Object.keys(metadata),
        ramKeys: shouldSendRam ? Object.keys(ramInputValues) : [],
      });

      const res = await mintNft({
        conn: phaCtx.conn as EasyConnect,
        carbonTokenId: carbonId,
        carbonSeriesId: selectedSeriesId,
        romSchema,
        metadataValues: metadata,
        romHex: romHex.trim(),
        ramSchema: shouldSendRam ? ramSchema : null,
        ramValues: shouldSendRam ? ramInputValues : undefined,
        maxData: DEFAULT_MAX_DATA,
        addLog,
      });

      if (!res.success) {
        throw new Error(res.error);
      }

      setTxHash(res.txHash);
      setMintedAddresses(res.carbonNftAddresses ?? null);
      setPhantasmaNftId(res.phantasmaNftId ?? null);
      addLog("[mint] Mint transaction confirmed", {
        txHash: res.txHash,
        phantasmaNftId: res.phantasmaNftId,
        carbonNftAddresses: res.carbonNftAddresses,
      });
      await loadSeriesNfts("", { reset: true });
      resetInputs();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMintError(message);
      addLog("[error] Mint transaction failed", { error: message });
    } finally {
      setSubmitting(false);
    }
  }, [
    phaCtx?.conn,
    selectedToken?.symbol,
    carbonId,
    selectedSeriesId,
    romSchema,
    ramSchema,
    ramFields,
    romHex,
    name,
    description,
    imageURL,
    infoURL,
    royaltiesBaseUnitsString,
    extraValues,
    ramValues,
    addLog,
    resetInputs,
    loadSeriesNfts,
  ]);

  const handleNextNftPage = useCallback(() => {
    if (!nftNextCursor) return;
    void loadSeriesNfts(nftNextCursor, { pageIndex: nftPageIndex + 1 });
  }, [nftNextCursor, nftPageIndex, loadSeriesNfts]);

  const handlePrevNftPage = useCallback(() => {
    if (nftPageIndex === 0) return;
    const prevCursor = nftCursorHistory[nftPageIndex - 1] ?? "";
    void loadSeriesNfts(prevCursor, { pageIndex: nftPageIndex - 1, preserveHistory: true });
  }, [nftPageIndex, nftCursorHistory, loadSeriesNfts]);

  if (!selectedToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a token to mint</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Choose a token from the list to prepare mint transactions.</p>
          <p>NFT minting controls will appear once an NFT token is selected.</p>
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
          Minting UI is only available for NFT tokens. Please pick an NFT token.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Mint NFT items for <span className="font-mono">{tokenPrimary}</span>
        </CardTitle>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleManualReset}
          disabled={loadingToken || submitting}
        >
          Reset
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingToken ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading token details…
          </div>
        ) : tokenError ? (
          <div className="text-sm text-red-600">{tokenError}</div>
        ) : !romSchema ? (
          <div className="text-sm text-muted-foreground">
            ROM schema unavailable. Unable to build minting form for this token.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">Series</div>
              {seriesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading series…
                </div>
              ) : seriesError ? (
                <div className="text-sm text-red-600">{seriesError}</div>
              ) : seriesList.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No series available. Create a series before minting individual NFTs.
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-mono"
                    >
                      <span className="truncate">
                        {selectedSeriesId != null
                          ? `Carbon Series #${selectedSeriesId}`
                          : "Select series"}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto p-1 min-w-[14rem]" align="start">
                    <DropdownMenuRadioGroup
                      value={selectedSeriesId != null ? String(selectedSeriesId) : ""}
                      onValueChange={(value) => {
                        const parsed = Number(value);
                        if (!Number.isNaN(parsed)) {
                          setSelectedSeriesId(parsed);
                        }
                      }}
                    >
                      {seriesList.map((series) => (
                        <DropdownMenuRadioItem
                          key={series.carbonSeriesId}
                          value={String(series.carbonSeriesId)}
                          className="cursor-pointer font-mono text-xs"
                        >
                          Carbon Series #{series.carbonSeriesId}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

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
                            alt="Token preview"
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
                    className={`w-full rounded border px-2 py-1${royaltiesInvalid ? " border-red-500 focus-visible:ring-red-500" : ""}`}
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
              {romFields.map((field) => {
                const key = field.name;
                if (
                  [
                    "_i",
                    "rom",
                    "id",
                    "name",
                    "description",
                    "imageURL",
                    "infoURL",
                    "royalties",
                  ].includes(key)
                ) {
                  return null;
                }
                const rawValue = extraValues[key] ?? "";
                const trimmedValue = rawValue.trim();
                const fieldInvalid =
                  trimmedValue.length > 0 && !isVmValueValid(field.type, trimmedValue);
                return (
                      <div key={key} className="space-y-1">
                        <div className="text-xs font-medium flex items-center gap-2">
                          <span>
                            {key} <span className="text-red-500">*</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatVmTypeLabel(field.type)}
                          </span>
                        </div>
                    <input
                      className={`w-full rounded border px-2 py-1${fieldInvalid ? " border-red-500 focus-visible:ring-red-500" : ""}`}
                      value={rawValue}
                      onChange={(e) =>
                        setExtraValues((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                );
              })}
              {visibleStandard.rom && (
                <div className="space-y-1 sm:col-span-2">
                  <div className="text-xs font-medium">
                    ROM (hex) <span className="text-muted-foreground">— use 0x for empty</span>
                  </div>
                  <input
                    className={`w-full rounded border px-2 py-1 font-mono${romHexInvalid ? " border-red-500 focus-visible:ring-red-500" : ""}`}
                    value={romHex}
                    onChange={(e) => setRomHex(e.target.value)}
                    placeholder="0x…"
                    required
                  />
                </div>
              )}
            </div>

            {ramSchema && ramFields.length > 0 && (
              <div className="space-y-2 rounded-lg border border-dashed bg-muted/10 p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  RAM metadata
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {ramFields.map((field) => {
                    const key = field.name;
                    if (!key) {
                      return null;
                    }
                    const rawValue = ramValues[key] ?? "";
                    const trimmedValue = rawValue.trim();
                    const fieldInvalid =
                      trimmedValue.length > 0 && !isVmValueValid(field.type, trimmedValue);
                    return (
                      <div key={key} className="space-y-1">
                        <div className="text-xs font-medium flex items-center gap-2">
                          <span>
                            {key} <span className="text-red-500">*</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatVmTypeLabel(field.type)}
                          </span>
                        </div>
                        <input
                          className={`w-full rounded border px-2 py-1${fieldInvalid ? " border-red-500 focus-visible:ring-red-500" : ""}`}
                          value={rawValue}
                          onChange={(e) =>
                            setRamValues((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleMint}
                disabled={!formValid || submitting || seriesList.length === 0}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Minting…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Mint NFT
                  </>
                )}
              </Button>
              {!canSign && (
                <span className="text-xs text-muted-foreground">Connect wallet to continue</span>
              )}
            </div>

            <div className="w-full space-y-2 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Mint status</div>
              {!submitting && !mintError && !txHash && (
                <div>No recent mint transactions.</div>
              )}
              {submitting && (
                <div className="flex items-center gap-2 text-amber-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for transaction confirmation…
                </div>
              )}
              {!submitting && !mintError && txHash && (
                <div className="space-y-2">
                  <div className="text-emerald-600 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    NFT minted successfully
                  </div>
                  {phantasmaNftId && (
                    <div className="text-xs">
                      Phantasma NFT ID:{" "}
                      <span className="font-mono" title={phantasmaNftId}>
                        {truncateMiddle(phantasmaNftId, 46, 12)}
                      </span>
                    </div>
                  )}
                  {mintedAddresses && mintedAddresses.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Carbon NFT addresses:</div>
                      <ul className="space-y-1">
                        {mintedAddresses.map((addr) => (
                          <li key={addr} className="font-mono text-xs break-all">
                            {addr}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs break-all" title={txHash}>
                      {truncateMiddle(txHash, 46, 12)}
                    </span>
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
              {!submitting && mintError && (
                <div className="space-y-1 text-destructive">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Mint failed: {mintError}
                  </div>
                  {txHash && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-mono text-xs break-all" title={txHash}>
                        {truncateMiddle(txHash, 46, 12)}
                      </span>
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

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">Existing NFTs in series</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handlePrevNftPage}
                    disabled={nftPageIndex === 0 || nftLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-[3rem] text-center text-xs text-muted-foreground">
                    Page {nftPageIndex + 1}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleNextNftPage}
                    disabled={!nftNextCursor || nftLoading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {nftLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading NFTs…
                </div>
              ) : nftError ? (
                <div className="text-sm text-destructive">{nftError}</div>
              ) : seriesNfts.length === 0 ? (
                <div className="text-sm text-muted-foreground">No NFTs minted in this series yet.</div>
              ) : (
                <div className="space-y-2">
                  {seriesNfts.map((nft) => (
                    <NftPreviewCard key={`${nft.carbonNftAddress}-${getNftId(nft)}`} nft={nft} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
