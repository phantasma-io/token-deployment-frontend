"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EasyConnect, NFT, Token } from "phantasma-sdk-ts";
import { Loader2, Sparkles, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

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

const NFT_PAGE_SIZE = 10;

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
  const [selectedOwnedNft, setSelectedOwnedNft] = useState<NFT | null>(null);

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
    setSelectedOwnedNft(null);
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
    if (selectedToken?.symbol && isNft) {
      void loadTokenDetails();
    }
  }, [selectedToken?.symbol, isNft, loadTokenDetails, resetSeriesNftListing]);

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
                        <Button type="button" variant="outline" className="w-full justify-between">
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
                  const selectedId = getNftId(selectedOwnedNft);
                  const isSelected =
                    !!selectedOwnedNft &&
                    !!nftId &&
                    !!selectedId &&
                    nftId === selectedId &&
                    selectedOwnedNft.carbonNftAddress === nft.carbonNftAddress;
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

                  return (
                    <NftPreviewCard
                      key={`${nft.carbonNftAddress}-${nftId || idx}`}
                      nft={nft}
                      selected={isSelected}
                      disabled={isTarget}
                      onSelect={() => setSelectedOwnedNft(nft)}
                    />
                  );
                })}
              </div>
            )}
              {selectedOwnedNft && (
                <div className="text-xs text-muted-foreground">
                  Infusion NFT:
                  <span className="ml-1 font-mono" title={getNftId(selectedOwnedNft) || undefined}>
                    {getNftId(selectedOwnedNft)
                      ? truncateMiddle(getNftId(selectedOwnedNft), 46, 12)
                      : "—"}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button type="button" disabled className="cursor-not-allowed opacity-60">
                  <Sparkles className="mr-2 h-4 w-4" /> Infuse
                </Button>
                {!selectedTargetNft && (
                  <span className="text-xs text-muted-foreground">Select target NFT first</span>
                )}
                {!selectedOwnedNft && selectedTargetNft && (
                  <span className="text-xs text-muted-foreground">Select NFT to infuse</span>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
