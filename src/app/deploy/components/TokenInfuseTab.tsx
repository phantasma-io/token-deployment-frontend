"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EasyConnect, NFT, Token, FeeOptions, TokenHelper, hexToBytes } from "phantasma-sdk-ts";
import { Loader2, Sparkles, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { getTokenPrimary, isTokenNFT } from "../utils/tokenHelpers";
import { getNftId, truncateMiddle } from "../utils/nftHelpers";
import type { AddLogFn } from "../types";
import {
  getTokenExtended,
  listTokenSeries,
  listTokenNfts,
  listAccountOwnedTokens,
  listAccountOwnedSeries,
  listAccountNfts,
  type TokenSeriesListItem,
  infuseNfts,
} from "@/lib/phantasmaClient";
import { NftPreviewCard } from "./NftPreviewCard";

type PhaCtxMinimal = {
  conn?: EasyConnect | null;
};

type TokenInfuseTabProps = {
  selectedToken: Token | null;
  phaCtx: PhaCtxMinimal;
  addLog: AddLogFn;
};

const NFT_PAGE_SIZE = 3;

type InfusionQueueItem = {
  nft: NFT;
  instanceId: bigint;
  carbonTokenId: bigint;
  carbonNftAddress: string;
};

const INFUSE_FEES_DEFAULTS = {
  gasFeeBase: "10000",
  feeMultiplier: "1000",
  maxDataLimit: "1000",
};

function parseBigIntInput(raw: string, label: string, opts?: { allowEmpty?: boolean; defaultValue?: bigint }) {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (opts?.allowEmpty) {
      return opts.defaultValue ?? 0n;
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

function extractCarbonNftInfo(address: string) {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("Carbon NFT address is required");
  }
  const bytes = hexToBytes(trimmed);
  if (bytes.length !== 32) {
    throw new Error("Carbon NFT address must be 32 bytes");
  }
  return TokenHelper.unpackNftAddress(bytes);
}

export function TokenInfuseTab({ selectedToken, phaCtx, addLog }: TokenInfuseTabProps) {
  const [loadingToken, setLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [carbonId, setCarbonId] = useState<bigint | null>(null);

  const [seriesList, setSeriesList] = useState<TokenSeriesListItem[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);

  const [seriesNfts, setSeriesNfts] = useState<NFT[]>([]);
  const [seriesNftLoading, setSeriesNftLoading] = useState(false);
  const [seriesNftError, setSeriesNftError] = useState<string | null>(null);
  const [seriesNftNextCursor, setSeriesNftNextCursor] = useState<string | null>(null);
  const [seriesNftCursorHistory, setSeriesNftCursorHistory] = useState<string[]>([""]);
  const [seriesNftPageIndex, setSeriesNftPageIndex] = useState(0);
  const [selectedTargetNft, setSelectedTargetNft] = useState<NFT | null>(null);

  const [ownedTokens, setOwnedTokens] = useState<Token[]>([]);
  const [ownedTokensLoading, setOwnedTokensLoading] = useState(false);
  const [ownedTokensError, setOwnedTokensError] = useState<string | null>(null);
  const [selectedOwnedTokenSymbol, setSelectedOwnedTokenSymbol] = useState<string>("");
  const [selectedOwnedTokenCarbonId, setSelectedOwnedTokenCarbonId] = useState<bigint | null>(null);

  const [ownedSeriesOptions, setOwnedSeriesOptions] = useState<TokenSeriesListItem[]>([]);
  const [ownedSeriesLoading, setOwnedSeriesLoading] = useState(false);
  const [ownedSeriesError, setOwnedSeriesError] = useState<string | null>(null);
  const [selectedOwnedSeriesId, setSelectedOwnedSeriesId] = useState<number | null>(null);

  const [ownedNfts, setOwnedNfts] = useState<NFT[]>([]);
  const [ownedNftLoading, setOwnedNftLoading] = useState(false);
  const [ownedNftError, setOwnedNftError] = useState<string | null>(null);
  const [ownedNftNextCursor, setOwnedNftNextCursor] = useState<string | null>(null);
  const [ownedNftCursorHistory, setOwnedNftCursorHistory] = useState<string[]>([""]);
  const [ownedNftPageIndex, setOwnedNftPageIndex] = useState(0);
  const [infusionQueue, setInfusionQueue] = useState<InfusionQueueItem[]>([]);
  const [infusing, setInfusing] = useState(false);
  const [infusionError, setInfusionError] = useState<string | null>(null);
  const [infusionTxHash, setInfusionTxHash] = useState<string | null>(null);
  const [feesExpanded, setFeesExpanded] = useState(false);
  const [gasFeeBase, setGasFeeBase] = useState<string>(INFUSE_FEES_DEFAULTS.gasFeeBase);
  const [feeMultiplier, setFeeMultiplier] = useState<string>(INFUSE_FEES_DEFAULTS.feeMultiplier);
  const [maxDataLimit, setMaxDataLimit] = useState<string>(INFUSE_FEES_DEFAULTS.maxDataLimit);

  const walletAddress = phaCtx?.conn?.link?.account?.address ?? null;

  const tokenPrimary = selectedToken
    ? getTokenPrimary(selectedToken, selectedToken.symbol)
    : "";
  const isNft = isTokenNFT(selectedToken || undefined);

  const resetSeriesNftListing = useCallback(() => {
    setSeriesNfts([]);
    setSeriesNftError(null);
    setSeriesNftNextCursor(null);
    setSeriesNftCursorHistory([""]);
    setSeriesNftPageIndex(0);
    setSelectedTargetNft(null);
  }, []);

  const resetOwnedNftListing = useCallback(() => {
    setOwnedNfts([]);
    setOwnedNftError(null);
    setOwnedNftNextCursor(null);
    setOwnedNftCursorHistory([""]);
    setOwnedNftPageIndex(0);
  }, []);

  const loadTokenDetails = useCallback(async () => {
    if (!selectedToken?.symbol) return;
    setLoadingToken(true);
    setTokenError(null);
    try {
      const token = await getTokenExtended(selectedToken.symbol);
      const rawCarbonId = token.carbonId;
      if (typeof rawCarbonId !== "string" || !rawCarbonId.trim()) {
        addLog("[error] Token info missing carbonId", { symbol: selectedToken.symbol });
        throw new Error("Carbon token id not available from RPC");
      }
      setCarbonId(BigInt(rawCarbonId.trim()));
      addLog("[infuse] Loaded token carbon id", { symbol: selectedToken.symbol, carbonId: rawCarbonId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTokenError(message);
      setCarbonId(null);
      addLog("[error] Failed to load token for infusion", { error: message });
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
        addLog("[infuse] Loaded series for token", { symbol, count: list.length });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setSeriesError(message);
        setSeriesList([]);
        setSelectedSeriesId(null);
        addLog("[error] Failed to load series for infusion", { error: message });
      } finally {
        setSeriesLoading(false);
      }
    },
    [addLog],
  );

  const loadSeriesNfts = useCallback(
    async (cursor: string, opts?: { reset?: boolean; pageIndex?: number }) => {
      if (!carbonId || !selectedSeriesId) return;
      setSeriesNftLoading(true);
      setSeriesNftError(null);
      try {
        const res = await listTokenNfts({
          carbonTokenId: carbonId,
          carbonSeriesId: selectedSeriesId,
          cursor,
          pageSize: NFT_PAGE_SIZE,
        });
        setSeriesNfts(res.items);
        setSeriesNftNextCursor(res.nextCursor);
        if (opts?.reset) {
          setSeriesNftCursorHistory([cursor]);
          setSeriesNftPageIndex(0);
        } else if (opts?.pageIndex !== undefined) {
          const pageIndex = opts.pageIndex;
          setSeriesNftPageIndex(pageIndex);
          setSeriesNftCursorHistory((prev) => {
            const next = prev.slice(0, pageIndex + 1);
            next[pageIndex] = cursor;
            return next;
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setSeriesNftError(message);
        setSeriesNfts([]);
        setSeriesNftNextCursor(null);
        addLog("[error] Failed to load NFTs for infusion target", { error: message });
      } finally {
        setSeriesNftLoading(false);
      }
    },
    [carbonId, selectedSeriesId, addLog],
  );

  const loadOwnedTokens = useCallback(async () => {
    if (!walletAddress) return;
    setOwnedTokensLoading(true);
    setOwnedTokensError(null);
    try {
      const res = await listAccountOwnedTokens({ account: walletAddress, pageSize: 100 });
      setOwnedTokens(res.items);
      addLog("[infuse] Loaded owned NFT tokens", { count: res.items.length });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setOwnedTokens([]);
      setOwnedTokensError(message);
      addLog("[error] Failed to load owned NFT tokens", { error: message });
    } finally {
      setOwnedTokensLoading(false);
    }
  }, [walletAddress, addLog]);

  const loadOwnedSeries = useCallback(async () => {
    if (!walletAddress || !selectedOwnedTokenSymbol) return;
    setOwnedSeriesLoading(true);
    setOwnedSeriesError(null);
    try {
      const res = await listAccountOwnedSeries({
        account: walletAddress,
        tokenSymbol: selectedOwnedTokenSymbol,
        carbonTokenId: selectedOwnedTokenCarbonId ?? 0n,
        pageSize: 100,
      });
      setOwnedSeriesOptions(res.items);
      addLog("[infuse] Loaded owned series for token", {
        token: selectedOwnedTokenSymbol,
        count: res.items.length,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setOwnedSeriesOptions([]);
      setOwnedSeriesError(message);
      addLog("[error] Failed to load owned series", { error: message });
    } finally {
      setOwnedSeriesLoading(false);
    }
  }, [walletAddress, selectedOwnedTokenSymbol, selectedOwnedTokenCarbonId, addLog]);

  const loadOwnedNfts = useCallback(
    async (cursor: string, opts?: { reset?: boolean; pageIndex?: number }) => {
      if (!walletAddress) return;
      setOwnedNftLoading(true);
      setOwnedNftError(null);
      try {
        const res = await listAccountNfts({
          account: walletAddress,
          tokenSymbol: selectedOwnedTokenSymbol,
          carbonTokenId: selectedOwnedTokenCarbonId ?? 0n,
          carbonSeriesId: selectedOwnedSeriesId ?? 0,
          cursor,
          pageSize: NFT_PAGE_SIZE,
        });
        setOwnedNfts(res.items);
        setOwnedNftNextCursor(res.nextCursor);
        if (opts?.reset) {
          setOwnedNftCursorHistory([cursor]);
          setOwnedNftPageIndex(0);
        } else if (opts?.pageIndex !== undefined) {
          const pageIndex = opts.pageIndex;
          setOwnedNftPageIndex(pageIndex);
          setOwnedNftCursorHistory((prev) => {
            const next = prev.slice(0, pageIndex + 1);
            next[pageIndex] = cursor;
            return next;
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setOwnedNftError(message);
        setOwnedNfts([]);
        setOwnedNftNextCursor(null);
        addLog("[error] Failed to load owned NFTs for infusion", { error: message });
      } finally {
        setOwnedNftLoading(false);
      }
    },
    [walletAddress, selectedOwnedTokenSymbol, selectedOwnedTokenCarbonId, selectedOwnedSeriesId, addLog],
  );

  useEffect(() => {
    setSeriesList([]);
    setSeriesError(null);
    setSelectedSeriesId(null);
    setCarbonId(null);
    resetSeriesNftListing();
    setTokenError(null);
    setInfusionQueue([]);
    setInfusionError(null);
    setInfusionTxHash(null);
    setInfusing(false);
    if (selectedToken?.symbol && isNft) {
      void loadTokenDetails();
    }
  }, [selectedToken?.symbol, isNft, loadTokenDetails, resetSeriesNftListing]);

  const targetCarbonAddress = selectedTargetNft?.carbonNftAddress ?? "";

  useEffect(() => {
    if (!targetCarbonAddress) return;
    setInfusionQueue((prev) => prev.filter((item) => item.carbonNftAddress !== targetCarbonAddress));
  }, [targetCarbonAddress]);

  useEffect(() => {
    if (selectedToken?.symbol && isNft && carbonId != null) {
      void loadSeries(selectedToken.symbol, carbonId);
    } else {
      setSeriesList([]);
      setSelectedSeriesId(null);
    }
  }, [selectedToken?.symbol, isNft, carbonId, loadSeries]);

  useEffect(() => {
    resetSeriesNftListing();
    if (carbonId != null && selectedSeriesId != null) {
      void loadSeriesNfts("", { reset: true });
    }
  }, [carbonId, selectedSeriesId, loadSeriesNfts, resetSeriesNftListing]);

  useEffect(() => {
    setOwnedTokens([]);
    setOwnedTokensError(null);
    setSelectedOwnedTokenSymbol("");
    setSelectedOwnedTokenCarbonId(null);
    setOwnedSeriesOptions([]);
    setOwnedSeriesError(null);
    setSelectedOwnedSeriesId(null);
    resetOwnedNftListing();
    setInfusionQueue([]);
    setInfusionError(null);
    setInfusionTxHash(null);
    if (walletAddress) {
      void loadOwnedTokens();
    }
  }, [walletAddress, loadOwnedTokens, resetOwnedNftListing]);

  useEffect(() => {
    setOwnedSeriesOptions([]);
    setOwnedSeriesError(null);
    setSelectedOwnedSeriesId(null);
    if (walletAddress && selectedOwnedTokenSymbol) {
      void loadOwnedSeries();
    }
  }, [walletAddress, selectedOwnedTokenSymbol, loadOwnedSeries]);

  useEffect(() => {
    resetOwnedNftListing();
    if (walletAddress) {
      void loadOwnedNfts("", { reset: true });
    }
  }, [walletAddress, selectedOwnedTokenSymbol, selectedOwnedTokenCarbonId, selectedOwnedSeriesId, loadOwnedNfts, resetOwnedNftListing]);

  const handleSeriesNext = useCallback(() => {
    if (!seriesNftNextCursor) return;
    void loadSeriesNfts(seriesNftNextCursor, { pageIndex: seriesNftPageIndex + 1 });
  }, [seriesNftNextCursor, seriesNftPageIndex, loadSeriesNfts]);

  const handleSeriesPrev = useCallback(() => {
    if (seriesNftPageIndex === 0) return;
    const prevCursor = seriesNftCursorHistory[seriesNftPageIndex - 1] ?? "";
    void loadSeriesNfts(prevCursor, { pageIndex: seriesNftPageIndex - 1 });
  }, [seriesNftPageIndex, seriesNftCursorHistory, loadSeriesNfts]);

  const handleOwnedNext = useCallback(() => {
    if (!ownedNftNextCursor) return;
    void loadOwnedNfts(ownedNftNextCursor, { pageIndex: ownedNftPageIndex + 1 });
  }, [ownedNftNextCursor, ownedNftPageIndex, loadOwnedNfts]);

  const handleOwnedPrev = useCallback(() => {
    if (ownedNftPageIndex === 0) return;
    const prevCursor = ownedNftCursorHistory[ownedNftPageIndex - 1] ?? "";
    void loadOwnedNfts(prevCursor, { pageIndex: ownedNftPageIndex - 1 });
  }, [ownedNftPageIndex, ownedNftCursorHistory, loadOwnedNfts]);

  const handleAddToQueue = useCallback((nft: NFT) => {
    const address = nft.carbonNftAddress;
    if (!address) return;
    if (targetCarbonAddress && address === targetCarbonAddress) return;
    let parsedInfo: ReturnType<typeof extractCarbonNftInfo>;
    try {
      parsedInfo = extractCarbonNftInfo(address);
    } catch (err) {
      addLog("[error] Unable to parse NFT carbon address", {
        error: (err as Error)?.message ?? String(err),
        address,
      });
      return;
    }
    const { instanceId, carbonTokenId } = parsedInfo;
    setInfusionQueue((prev) => {
      if (prev.some((item) => item.carbonNftAddress === address)) return prev;
      return [...prev, { nft, instanceId, carbonTokenId, carbonNftAddress: address }];
    });
  }, [addLog, targetCarbonAddress]);

  const handleRemoveFromQueue = useCallback((address: string) => {
    setInfusionQueue((prev) => prev.filter((item) => item.carbonNftAddress !== address));
  }, []);

  const handleClearQueue = useCallback(() => {
    setInfusionQueue([]);
  }, []);
  const handleResetFees = useCallback(() => {
    setGasFeeBase(INFUSE_FEES_DEFAULTS.gasFeeBase);
    setFeeMultiplier(INFUSE_FEES_DEFAULTS.feeMultiplier);
    setMaxDataLimit(INFUSE_FEES_DEFAULTS.maxDataLimit);
  }, []);

  const infuseDisabled = !targetCarbonAddress || infusionQueue.length === 0 || infusing;

  const handleInfuse = useCallback(async () => {
    if (!targetCarbonAddress) {
      setInfusionError("Select target NFT to infuse into");
      return;
    }
    if (infusionQueue.length === 0) {
      setInfusionError("Add NFTs to the infusion queue");
      return;
    }
    const walletConn = phaCtx?.conn;
    if (!walletConn) {
      const message = "Connect wallet before infusing";
      setInfusionError(message);
      addLog("[error] Wallet not connected for infusion", {});
      return;
    }
    if (carbonId == null) {
      const message = "Token carbon id is not available yet";
      setInfusionError(message);
      addLog("[error] Token carbon id missing for infusion", { symbol: selectedToken?.symbol });
      return;
    }
    let gasFeeBaseValue: bigint;
    let feeMultiplierValue: bigint;
    let maxDataValue: bigint;
    try {
      gasFeeBaseValue = parseBigIntInput(gasFeeBase, "Gas fee base");
      feeMultiplierValue = parseBigIntInput(feeMultiplier, "Fee multiplier");
      maxDataValue = parseBigIntInput(maxDataLimit, "Max data limit", { allowEmpty: true, defaultValue: 0n });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInfusionError(message);
      addLog("[error] Invalid fee configuration for infusion", { error: message });
      return;
    }
    const feeOptions = new FeeOptions(gasFeeBaseValue, feeMultiplierValue);
    setInfusing(true);
    setInfusionError(null);
    setInfusionTxHash(null);
    try {
      const groupedByToken = new Map<string, { carbonTokenId: bigint; instanceIds: bigint[] }>();
      for (const item of infusionQueue) {
        const key = item.carbonTokenId.toString();
        const existing = groupedByToken.get(key);
        if (existing) {
          existing.instanceIds.push(item.instanceId);
        } else {
          groupedByToken.set(key, { carbonTokenId: item.carbonTokenId, instanceIds: [item.instanceId] });
        }
      }
      const instanceGroups = Array.from(groupedByToken.values());
      if (instanceGroups.length === 0) {
        throw new Error("No NFTs selected for infusion");
      }
      const totalInstances = infusionQueue.length;
      const res = await infuseNfts({
        conn: walletConn,
        targetCarbonAddress,
        groups: instanceGroups,
        feeOptions,
        maxData: maxDataValue,
      });
      if (!res.success) {
        throw new Error(res.error);
      }
      setInfusionTxHash(res.txHash);
      addLog("[infuse] Submitted infusion transaction", {
        txHash: res.txHash,
        target: targetCarbonAddress,
        count: totalInstances,
        token_groups: instanceGroups.length,
      });
      setInfusionQueue([]);
      await loadSeriesNfts("", { reset: true });
      await loadOwnedNfts("", { reset: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setInfusionError(message);
      addLog("[error] Infusion transaction failed", { error: message });
    } finally {
      setInfusing(false);
    }
  }, [
    phaCtx?.conn,
    targetCarbonAddress,
    carbonId,
    infusionQueue,
    gasFeeBase,
    feeMultiplier,
    maxDataLimit,
    loadSeriesNfts,
    loadOwnedNfts,
    addLog,
    selectedToken?.symbol,
  ]);

  const ownedTokenOptionsDisplay = useMemo(() => {
    return ownedTokens.map((token) => {
      let tokenCarbonId: bigint | null = null;
      const rawCarbonId = token.carbonId;
      if (typeof rawCarbonId === "string" && rawCarbonId.trim().length > 0) {
        tokenCarbonId = BigInt(rawCarbonId.trim());
      }
      return { symbol: token.symbol, label: getTokenPrimary(token, token.symbol), carbonId: tokenCarbonId };
    });
  }, [ownedTokens]);

  const isFeesDefault = useMemo(() => {
    return (
      gasFeeBase.trim() === INFUSE_FEES_DEFAULTS.gasFeeBase &&
      feeMultiplier.trim() === INFUSE_FEES_DEFAULTS.feeMultiplier &&
      maxDataLimit.trim() === INFUSE_FEES_DEFAULTS.maxDataLimit
    );
  }, [gasFeeBase, feeMultiplier, maxDataLimit]);

  if (!selectedToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select an NFT token to infuse</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Choose an NFT token to configure infusion.</p>
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
          Infusion is available only for NFT tokens. Pick an NFT token.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Infuse NFT <span className="font-mono">{tokenPrimary}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingToken ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading token details…
          </div>
        ) : tokenError ? (
          <div className="text-sm text-red-600">{tokenError}</div>
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
                <div className="text-sm text-muted-foreground">No series available for this token.</div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between font-mono">
                      <span className="truncate">
                        {selectedSeriesId != null ? `Carbon Series #${selectedSeriesId}` : "Select series"}
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

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">Select target NFT</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleSeriesPrev}
                    disabled={seriesNftPageIndex === 0 || seriesNftLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-[3rem] text-center text-xs text-muted-foreground">
                    Page {seriesNftPageIndex + 1}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleSeriesNext}
                    disabled={!seriesNftNextCursor || seriesNftLoading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {seriesNftLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading NFTs…
                </div>
              ) : seriesNftError ? (
                <div className="text-sm text-destructive">{seriesNftError}</div>
              ) : seriesNfts.length === 0 ? (
                <div className="text-sm text-muted-foreground">No NFTs minted in this series yet.</div>
              ) : (
                <div className="space-y-2">
                  {seriesNfts.map((nft, idx) => {
                    const nftId = getNftId(nft);
                    const selectedId = getNftId(selectedTargetNft);
                    const isSelected =
                      !!selectedTargetNft &&
                      !!nftId &&
                      !!selectedId &&
                      nftId === selectedId &&
                      selectedTargetNft.carbonNftAddress === nft.carbonNftAddress;
                    return (
                      <NftPreviewCard
                        key={`${nft.carbonNftAddress}-${nftId || idx}`}
                        nft={nft}
                        selected={isSelected}
                        onSelect={() => setSelectedTargetNft(nft)}
                      />
                    );
                  })}
                </div>
              )}
              {selectedTargetNft && (
                <div className="text-xs text-muted-foreground">
                  Target NFT:
                  <span className="ml-1 font-mono" title={getNftId(selectedTargetNft) || undefined}>
                    {getNftId(selectedTargetNft)
                      ? truncateMiddle(getNftId(selectedTargetNft), 46, 12)
                      : "—"}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex-1">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Token filter</div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-between"
                          disabled={ownedTokensLoading}
                        >
                          <span className="truncate">
                            {selectedOwnedTokenSymbol
                              ? selectedOwnedTokenSymbol
                              : "All tokens"}
                          </span>
                          <ChevronDown className="ml-2 h-4 w-4 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto p-1 min-w-[14rem]" align="start">
                        <DropdownMenuRadioGroup
                          value={selectedOwnedTokenSymbol}
                          onValueChange={(value) => {
                            if (value === "") {
                              setSelectedOwnedTokenSymbol("");
                              setSelectedOwnedTokenCarbonId(null);
                              return;
                            }
                            const found = ownedTokenOptionsDisplay.find((opt) => opt.symbol === value);
                            setSelectedOwnedTokenSymbol(value);
                            setSelectedOwnedTokenCarbonId(found?.carbonId ?? null);
                          }}
                        >
                          <DropdownMenuRadioItem value="" className="cursor-pointer">
                            All tokens
                          </DropdownMenuRadioItem>
                          {ownedTokenOptionsDisplay.map((opt) => (
                            <DropdownMenuRadioItem key={opt.symbol} value={opt.symbol} className="cursor-pointer">
                              {opt.label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Series filter</div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-between"
                          disabled={!selectedOwnedTokenSymbol || ownedSeriesLoading || ownedSeriesOptions.length === 0}
                        >
                          <span className="truncate">
                            {!selectedOwnedTokenSymbol
                              ? "Select token first"
                              : selectedOwnedSeriesId != null
                                ? `Series #${selectedOwnedSeriesId}`
                                : ownedSeriesLoading
                                  ? "Loading…"
                                  : "All series"}
                          </span>
                          <ChevronDown className="ml-2 h-4 w-4 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto p-1 min-w-[14rem]" align="start">
                        <DropdownMenuRadioGroup
                          value={selectedOwnedSeriesId != null ? String(selectedOwnedSeriesId) : ""}
                          onValueChange={(value) => {
                            if (value === "") {
                              setSelectedOwnedSeriesId(null);
                            } else {
                              const parsed = Number(value);
                              if (!Number.isNaN(parsed)) setSelectedOwnedSeriesId(parsed);
                            }
                          }}
                        >
                          <DropdownMenuRadioItem value="" className="cursor-pointer">
                            All series
                          </DropdownMenuRadioItem>
                          {ownedSeriesOptions.map((series) => (
                            <DropdownMenuRadioItem
                              key={series.carbonSeriesId}
                              value={String(series.carbonSeriesId)}
                              className="cursor-pointer"
                            >
                              Series #{series.carbonSeriesId}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {ownedTokensError && (
                  <div className="text-xs text-destructive">{ownedTokensError}</div>
                )}
                {ownedTokensLoading && (
                  <div className="text-xs text-muted-foreground">Loading owned NFT tokens…</div>
                )}
                {ownedSeriesError && selectedOwnedTokenSymbol && (
                  <div className="text-xs text-destructive">{ownedSeriesError}</div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">Select NFT to infuse</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleOwnedPrev}
                    disabled={ownedNftPageIndex === 0 || ownedNftLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-[3rem] text-center text-xs text-muted-foreground">
                    Page {ownedNftPageIndex + 1}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleOwnedNext}
                    disabled={!ownedNftNextCursor || ownedNftLoading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

            {!walletAddress ? (
              <div className="text-sm text-muted-foreground">Connect wallet to see NFTs you can infuse.</div>
            ) : ownedNftLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading owned NFTs…
              </div>
            ) : ownedNftError ? (
              <div className="text-sm text-destructive">{ownedNftError}</div>
            ) : ownedNfts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No NFTs available with current filters.</div>
            ) : (
              <div className="space-y-2">
                {ownedNfts.map((nft, idx) => {
                  const nftId = getNftId(nft);
                  const isTarget = (() => {
                    const targetId = getNftId(selectedTargetNft);
                    return (
                      !!selectedTargetNft &&
                      !!targetId &&
                      !!nftId &&
                      targetId === nftId &&
                      selectedTargetNft.carbonNftAddress === nft.carbonNftAddress
                    );
                  })();
                  const alreadyQueued = infusionQueue.some((item) => item.carbonNftAddress === nft.carbonNftAddress);
                  return (
                    <div key={`${nft.carbonNftAddress}-${nftId || idx}`} className="space-y-1">
                      <NftPreviewCard
                        nft={nft}
                        disabled={isTarget || alreadyQueued}
                        onSelect={() => handleAddToQueue(nft)}
                      />
                      <div className="text-[11px] text-muted-foreground">
                        {isTarget
                          ? "Cannot infuse target NFT"
                          : alreadyQueued
                            ? "Already in queue"
                            : "Click to add into infusion queue"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">NFTs to infuse</div>
                {infusionQueue.length > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={handleClearQueue}>
                    Clear queue
                  </Button>
                )}
              </div>
              {infusionQueue.length === 0 ? (
                <div className="text-sm text-muted-foreground">Queue is empty.</div>
              ) : (
                <div className="space-y-2">
                  {infusionQueue.map((item) => (
                    <div key={item.carbonNftAddress} className="flex items-start gap-2 rounded border p-2">
                      <div className="flex-1">
                        <NftPreviewCard nft={item.nft} disabled />
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Instance ID:
                          <span className="ml-1 font-mono">
                            {truncateMiddle(item.instanceId.toString(), 46, 12)}
                          </span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveFromQueue(item.carbonNftAddress)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3 rounded-lg border border-dashed bg-muted/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left focus:outline-none"
                    onClick={() => setFeesExpanded((prev) => !prev)}
                    aria-expanded={feesExpanded}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
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
                    {isFeesDefault && (
                      <span className="text-xs text-emerald-600 ml-2">Using default fees and limits</span>
                    )}
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={handleResetFees}
                    disabled={isFeesDefault}
                  >
                    Reset
                  </Button>
                </div>
                {feesExpanded ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Adjust Carbon gas fees, payload allowance, and expiry window for this infusion transaction.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">Gas fee base</label>
                        <input
                          className="w-full rounded border px-2 py-1 font-mono"
                          inputMode="numeric"
                          value={gasFeeBase}
                          onChange={(e) => setGasFeeBase(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Fee multiplier</label>
                        <input
                          className="w-full rounded border px-2 py-1 font-mono"
                          inputMode="numeric"
                          value={feeMultiplier}
                          onChange={(e) => setFeeMultiplier(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Max data (bytes)</label>
                        <input
                          className="w-full rounded border px-2 py-1 font-mono"
                          inputMode="numeric"
                          value={maxDataLimit}
                          onChange={(e) => setMaxDataLimit(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button type="button" onClick={handleInfuse} disabled={infuseDisabled}>
                  {infusing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Infusing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" /> Infuse
                    </>
                  )}
                </Button>
                {!selectedTargetNft && (
                  <span className="text-xs text-muted-foreground">Select target NFT first</span>
                )}
                {selectedTargetNft && infusionQueue.length === 0 && (
                  <span className="text-xs text-muted-foreground">Add NFTs to the queue</span>
                )}
              </div>

              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">Infusion status</div>
                {infusing && (
                  <div className="flex items-center gap-2 text-amber-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Waiting for transaction confirmation…
                  </div>
                )}
                {!infusing && infusionTxHash && (
                  <div className="flex items-center gap-2 text-emerald-600">
                    Transaction confirmed
                    <span className="font-mono text-xs break-all">{infusionTxHash}</span>
                  </div>
                )}
                {!infusing && infusionError && (
                  <div className="text-destructive">Infusion failed: {infusionError}</div>
                )}
              </div>
            </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
