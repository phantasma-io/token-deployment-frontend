"use client";

import { useContext, useEffect, useState } from "react";
import { PhaAccountWidgetV1, PhaConnectCtx } from "@phantasma/connect-react";
import { toast } from "sonner";
import { getTokens, deployCarbonToken } from "@/lib/phantasmaClient";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DebugLogger } from "@/components/DebugLogger";
import { RefreshCw, Plus, Trash2, Upload, ChevronDown } from "lucide-react";

/**
 * Deploy page
 *
 * - lists tokens for connected owner (via getTokens(ownerAddress))
 * - provides a form to configure and deploy a Carbon token (Fungible or NFT)
 *
 * Notes:
 * - This page relies on `phaCtx` (PhaConnectCtx) for wallet connection state and `conn` object.
 * - deployCarbonToken from `src/lib/phantasmaClient.ts` is used to build/sign/send the transaction.
 */
import { observer } from "mobx-react-lite";
import { CreateTokenFeeOptions, Token } from "phantasma-sdk-ts";

const DeployPage = observer(() => {
  const phaCtx = useContext(PhaConnectCtx);

  const [tokens, setTokens] = useState<any[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [expandedTokens, setExpandedTokens] = useState<Record<string, boolean>>(
    {},
  );
  const [currentPage, setCurrentPage] = useState(1);

  // Form state
  const [isNFT, setIsNFT] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [decimals, setDecimals] = useState<number>(8);
  const [lastFungibleDecimals, setLastFungibleDecimals] = useState<number>(8);
  const [maxSupply, setMaxSupply] = useState<string>("0");
  const [gasFeeBase, setGasFeeBase] = useState("10000");
  const [gasFeeCreateTokenBase, setGasFeeCreateTokenBase] = useState("10000000000");
  const [gasFeeCreateTokenSymbol, setGasFeeCreateTokenSymbol] = useState("10000000000");
  const [gasFeeMultiplier, setGasFeeMultiplier] = useState("10000");
  const [maxDataLimit, setMaxDataLimit] = useState("1000000000");
  const [logoDataUri, setLogoDataUri] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [metadataFields, setMetadataFields] = useState<
    { id: number; key: string; value: string }[]
  >([]);
  const [metadataIdCounter, setMetadataIdCounter] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [txStatus, setTxStatus] = useState<
    | { kind: "idle" }
    | { kind: "pending"; symbol: string }
    | { kind: "success"; hash: string; tokenId?: number }
    | { kind: "failure"; message: string; hash?: string }
  >({ kind: "idle" });

  // Debug logs
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Helper function to add debug logs
  const addLog = (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}`;
    console.log(message, data);
    setDebugLogs(prev => [...prev, logEntry]);
  };

  const clearLogs = () => {
    setDebugLogs([]);
  };

  const parseBigIntField = (
    raw: string,
    label: string,
    allowEmpty = false,
  ): bigint => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      if (allowEmpty) return 0n;
      throw new Error(`${label} is required`);
    }
    try {
      const value = BigInt(trimmed);
      if (value < 0n) {
        throw new Error(`${label} must be non-negative`);
      }
      return value;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Invalid value for ${label}`;
      throw new Error(message);
    }
  };

  // Load tokens when wallet connects / address changes
  useEffect(() => {
    addLog('🔄 useEffect triggered - checking wallet connection', {
      is_connected: phaCtx?.is_connected,
      conn_exists: !!phaCtx?.conn,
      link_exists: !!phaCtx?.conn?.link,
      account_exists: !!phaCtx?.conn?.link?.account,
      address: phaCtx?.conn?.link?.account?.address,
      full_phaCtx: {
        ...phaCtx,
        conn: phaCtx?.conn ? {
          connected: phaCtx.conn.connected,
          platform: phaCtx.conn.platform,
          providerHint: phaCtx.conn.providerHint,
          link: phaCtx.conn.link ? {
            account: {
              address: phaCtx.conn.link.account?.address,
              name: phaCtx.conn.link.account?.name
            }
          } : null
        } : null
      }
    });

    if (!phaCtx?.conn?.link?.account?.address) {
      addLog('❌ No wallet address found, clearing tokens');
      setTokens([]);
      return;
    }

    const addr = phaCtx.conn.link.account.address;
    addLog('✅ Wallet address found, loading tokens', { address: addr });
    loadTokens(addr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaCtx?.is_connected, phaCtx?.conn?.link?.account?.address]);

  async function loadTokens(ownerAddress: string) {
    addLog('🔄 loadTokens started', { ownerAddress });
    setLoadingTokens(true);

    try {
      addLog('📞 Calling getTokens API', {
        ownerAddress,
        api_url: process.env.NEXT_PUBLIC_API_URL,
        nexus: process.env.NEXT_PUBLIC_PHANTASMA_NEXUS
      });

      const list = await getTokens(ownerAddress);

      addLog('📥 getTokens response received', {
        response_type: typeof list,
        is_array: Array.isArray(list),
        length: list?.length,
        first_few_items: list?.slice(0, 3),
        full_response: list
      });

      setTokens(list ?? []);
      setCurrentPage(1);
      setExpandedTokens({});
      addLog('✅ Tokens state updated', { tokens_count: (list ?? []).length });

    } catch (err: any) {
      addLog('❌ loadTokens failed', {
        error_message: err?.message,
        error_name: err?.name,
        error_stack: err?.stack,
        error_response: err?.response,
        error_status: err?.status,
        full_error: err
      });

      console.error("Failed to load tokens", err);
      toast.error("Failed to load tokens");
      setTokens([]);
    } finally {
      setLoadingTokens(false);
      addLog('🏁 loadTokens finished');
    }
  }

  function resetForm() {
    setSymbol("");
    setName("");
    setDecimals(8);
    setLastFungibleDecimals(8);
    setMaxSupply("0");
    setGasFeeBase("10000");
    setGasFeeCreateTokenBase("10000000000");
    setGasFeeCreateTokenSymbol("10000000000");
    setGasFeeMultiplier("10000");
    setMaxDataLimit("1000000000");
    setLogoDataUri(null);
    setLogoFileName(null);
    setMetadataFields([]);
    setMetadataIdCounter(0);
    setIsNFT(false);
    setExpandedTokens({});
  }

  async function handleDeploy() {
    addLog('🚀 handleDeploy started', {
      symbol,
      name,
      isNFT,
      decimals,
      maxSupply,
      has_logo: !!logoDataUri,
      metadata_fields: metadataFields,
      wallet_connected: !!phaCtx?.conn,
      owner_address: phaCtx?.conn?.link?.account?.address
    });

    if (!phaCtx?.conn) {
      addLog('❌ No wallet connection');
      toast.error("Connect wallet first");
      return;
    }
    if (!symbol || symbol.trim().length === 0) {
      addLog('❌ Symbol is required');
      toast.error("Symbol is required");
      return;
    }

    let maxSupplyBig: bigint;
    let maxDataBig: bigint;
    let feeConfig = new CreateTokenFeeOptions();
    try {
      maxSupplyBig = parseBigIntField(maxSupply, "Max supply", true);
      maxDataBig = parseBigIntField(maxDataLimit, "Max data", true);
      feeConfig.gasFeeBase = parseBigIntField(gasFeeBase, "Gas fee base");
      feeConfig.gasFeeCreateTokenBase = parseBigIntField(
        gasFeeCreateTokenBase,
        "Gas fee create token base");
      feeConfig.gasFeeCreateTokenSymbol = parseBigIntField(
        gasFeeCreateTokenSymbol,
        "Gas fee create token symbol",
      );
      feeConfig.feeMultiplier = parseBigIntField(gasFeeMultiplier, "Gas fee multiplier");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog('❌ Fee/max parse failed', { error: message });
      toast.error(message);
      return;
    }

    addLog('⚙️ Fee configuration parsed', {
      gasFeeBase: feeConfig.gasFeeBase.toString(),
      gasFeeCreateTokenBase: feeConfig.gasFeeCreateTokenBase.toString(),
      gasFeeCreateTokenSymbol: feeConfig.gasFeeCreateTokenSymbol.toString(),
      feeMultiplier: feeConfig.feeMultiplier.toString(),
      maxData: maxDataBig.toString(),
      maxSupply: maxSupplyBig.toString(),
    });

    setDeploying(true);
    toast(`Deploying ${symbol}...`);

    try {
      const ownerAddress = phaCtx.conn.link.account.address;
      const metadataObj: Record<string, string> = {};
      if (logoDataUri) {
        metadataObj.logo = logoDataUri;
      }
      metadataFields.forEach(({ key, value }) => {
        const trimmedKey = key.trim();
        if (!trimmedKey) return;
        metadataObj[trimmedKey] = value;
      });

      const metadata =
        Object.keys(metadataObj).length > 0 ? metadataObj : undefined;

      addLog('🧾 Compiled metadata', { metadata });

      addLog('🚀🚀 Deploying carbon token', {
        ownerAddress,
        symbol: symbol.trim(),
        name: name.trim() || undefined,
        isNFT,
        decimals: decimals ?? 0,
        maxSupply: maxSupplyBig.toString(),
        metadata: metadata,
        feeOptions: {
          gasFeeBase: feeConfig.gasFeeBase.toString(),
          gasFeeCreateTokenBase: feeConfig.gasFeeCreateTokenBase.toString(),
          gasFeeCreateTokenSymbol:
            feeConfig.gasFeeCreateTokenSymbol.toString(),
          feeMultiplier: feeConfig.feeMultiplier.toString(),
        },
        maxData: maxDataBig.toString(),
      });

      const res = await deployCarbonToken({
        conn: phaCtx.conn,
        ownerAddress,
        symbol: symbol.trim(),
        name: name.trim() || undefined,
        isNFT,
        decimals: decimals ?? 0,
        maxSupply: maxSupplyBig,
        metadata: metadata,
        feeOptions: feeConfig,
        maxData: maxDataBig,
      });

      addLog('📥 deployCarbonToken response', { response: res });

      if (!res.success) {
        addLog('❌ Deploy failed', { error: res.error });
        console.error("Deploy error:", res.error);
        toast.error("Deploy failed: " + (res.error ?? "unknown"));
        setTxStatus({
          kind: "failure",
          message: res.error ?? "Transaction failure",
        });
        setDeploying(false);
        return;
      }

      addLog('✅ Deploy successful', { txHash: res.txHash, tokenId: res.tokenId });
      toast.success(`Deploy TX confirmed: ${res.txHash ?? "unknown-hash"}`);
      setTxStatus({
        kind: "success",
        hash: res.txHash ?? "",
        tokenId: res.tokenId,
      });

      // Refresh tokens list
      addLog('🔄 Refreshing tokens list after deploy');
      await loadTokens(ownerAddress);

      setExpandedTokens((prev) => ({
        ...prev,
        [symbol.trim()]: true,
      }));
      resetForm();
      addLog('✅ Deploy process completed');
    } catch (err: any) {
      const message = err?.message ?? String(err);
      addLog('❌ Deploy exception', {
        error_message: message,
        error_name: err?.name,
        error_stack: err?.stack,
        full_error: err
      });
      console.error("Deploy exception", err);
      toast.error("Deploy error: " + message);
      setTxStatus({ kind: "failure", message });
    } finally {
      setDeploying(false);
      addLog('🏁 handleDeploy finished');
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Token Deployment</h1>
          <p className="text-muted-foreground">Deploy new Carbon tokens on Phantasma blockchain</p>
        </div>
        <PhaAccountWidgetV1 state={phaCtx} />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left: tokens list */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              🪙 Your Tokens
              {phaCtx?.conn?.link?.account?.address && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({tokens.length})
                </span>
              )}
            </CardTitle>
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={
                loadingTokens || !phaCtx?.conn?.link?.account?.address
              }
              onClick={() => {
                const addr = phaCtx?.conn?.link?.account?.address;
                if (addr) {
                  addLog('🔄 Refresh button clicked', { address: addr });
                  void loadTokens(addr);
                }
              }}
            >
              <RefreshCw className={loadingTokens ? "animate-spin" : ""} />
            </Button>
          </CardHeader>
          <CardContent>
            {tokens.length > 0 && (
              <div className="mb-3 flex items-center justify-end gap-3 text-xs text-muted-foreground">
                <span>
                  Page {currentPage} of{" "}
                  {Math.max(1, Math.ceil(tokens.length / 10))}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      currentPage >= Math.max(
                        1,
                        Math.ceil(tokens.length / 10),
                      )
                    }
                    onClick={() =>
                      setCurrentPage((p) =>
                        Math.min(
                          Math.max(1, Math.ceil(tokens.length / 10)),
                          p + 1,
                        ),
                      )
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
            {!phaCtx?.conn?.link?.account?.address ? (
              <div className="text-center py-8">
                <div className="text-2xl mb-2">🔒</div>
                <div className="text-sm text-muted-foreground">
                  Connect your wallet to view and deploy tokens
                </div>
              </div>
            ) : loadingTokens ? (
              <div className="text-center py-4">
                <div className="text-lg mb-2">⏳</div>
                <div>Loading tokens...</div>
              </div>
            ) : tokens.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-2xl mb-2">📭</div>
                <div className="text-sm text-muted-foreground">
                  No tokens found for this address
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Deploy your first token using the form →
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {tokens
                  .slice((currentPage - 1) * 10, currentPage * 10)
                  .map((t: Token, idx: number) => {
                    const sym = t?.symbol;
                    const primary = String(sym ?? `#${idx}`);
                    const name = t?.name;
                    const currentSupply = t?.currentSupply;
                    const maxSupply = t?.maxSupply;
                    const isNFTItem = !primary.includes("Fungible");
                    const decimals = t?.decimals;
                    const isExpanded = !!expandedTokens[primary];

                    return (
                      <li
                        key={primary || idx}
                        className={[
                          "p-4 rounded-lg border transition-all hover:shadow-md",
                          isExpanded
                            ? "border-primary bg-primary/5"
                            : "border-muted",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={
                                isExpanded
                                  ? `Hide details for ${primary}`
                                  : `Show details for ${primary}`
                              }
                              onClick={() =>
                                setExpandedTokens((prev) => ({
                                  ...prev,
                                  [primary]: !prev[primary],
                                }))
                              }
                              className="border border-transparent text-muted-foreground hover:text-foreground"
                            >
                              <ChevronDown
                                size={16}
                                className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              />
                            </Button>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-lg">
                                  {primary}
                                </span>
                                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                  {isNFTItem ? "NFT" : "Fungible"}
                                </span>
                              </div>
                              {isExpanded && name && (
                                <div className="text-sm text-muted-foreground mt-1">
                                  {name}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs text-muted-foreground space-y-1">
                              {name && <div>Name: {name}</div>}
                              {currentSupply && <div>Current Supply: {currentSupply}</div>}
                              {maxSupply && <div>Max Supply: {maxSupply}</div>}
                              {<div>Decimals: {decimals}</div>}
                            </div>
                            <pre className="max-h-48 max-w-full overflow-auto rounded border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">
                              {JSON.stringify(t, null, 2)}
                            </pre>
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </CardContent>
          <CardFooter className="h-0 p-0" />
        </Card>

        {/* Right: deploy form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              🚀 Deploy New Token
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Create a new Carbon token on Phantasma blockchain
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={!isNFT ? "default" : "outline"}
                  onClick={() => {
                    setIsNFT(false);
                    setDecimals(lastFungibleDecimals);
                  }}
                >
                  Fungible
                </Button>
                <Button
                  type="button"
                  variant={isNFT ? "default" : "outline"}
                  onClick={() => {
                    setIsNFT(true);
                    setLastFungibleDecimals(decimals);
                    setDecimals(0);
                  }}
                >
                  NFT
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Symbol</label>
              <input
                className="w-full rounded border px-2 py-1"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="SYMB"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Name (optional)</label>
              <input
                className="w-full rounded border px-2 py-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My token name"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  className={`block text-sm font-medium mb-1 ${isNFT ? "text-muted-foreground" : ""
                    }`}
                >
                  Decimals
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded border px-2 py-1"
                  value={decimals}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setDecimals(value);
                    setLastFungibleDecimals(value);
                  }}
                  disabled={isNFT}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Max supply</label>
                <input
                  className="w-full rounded border px-2 py-1"
                  value={maxSupply}
                  onChange={(e) => setMaxSupply(e.target.value)}
                  placeholder="0 for unlimited"
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-dashed bg-muted/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Metadata
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Optional fields that populate the token metadata
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Logo</label>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium bg-background hover:bg-muted transition">
                      <Upload size={16} />
                      <span>Choose file</span>
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.svg"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) {
                            setLogoDataUri(null);
                            setLogoFileName(null);
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = (loadEvt) => {
                            const result = loadEvt.target?.result;
                            if (typeof result === "string") {
                              setLogoDataUri(result);
                              setLogoFileName(file.name);
                              addLog('🖼️ Logo loaded', {
                                name: file.name,
                                size: file.size,
                                type: file.type,
                              });
                            } else {
                              toast.error("Failed to read logo file");
                              setLogoDataUri(null);
                              setLogoFileName(null);
                            }
                          };
                          reader.onerror = () => {
                            toast.error("Failed to read logo file");
                            setLogoDataUri(null);
                            setLogoFileName(null);
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    <div className="flex-1 rounded border bg-background px-3 py-2 text-sm">
                      {logoFileName ? (
                        <span className="block truncate">{logoFileName}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          No file selected
                        </span>
                      )}
                    </div>
                    {logoFileName && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setLogoDataUri(null);
                          setLogoFileName(null);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {logoDataUri && (
                    <p className="text-xs text-muted-foreground break-all">
                      {logoDataUri.slice(0, 48)}…
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      Additional metadata
                    </label>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        setMetadataFields((prev) => [
                          ...prev,
                          { id: metadataIdCounter, key: "", value: "" },
                        ]);
                        setMetadataIdCounter((prev) => prev + 1);
                      }}
                    >
                      <Plus size={16} />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {metadataFields.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No custom fields. Click + to add key/value pairs.
                      </p>
                    )}
                    {metadataFields.map((field) => (
                      <div
                        key={field.id}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center"
                      >
                        <input
                          className="w-full rounded border px-2 py-1 sm:flex-1"
                          placeholder="Key"
                          value={field.key}
                          onChange={(e) => {
                            const value = e.target.value;
                            setMetadataFields((prev) =>
                              prev.map((item) =>
                                item.id === field.id
                                  ? { ...item, key: value }
                                  : item,
                              ),
                            );
                          }}
                        />
                        <input
                          className="w-full rounded border px-2 py-1 sm:flex-1"
                          placeholder="Value"
                          value={field.value}
                          onChange={(e) => {
                            const value = e.target.value;
                            setMetadataFields((prev) =>
                              prev.map((item) =>
                                item.id === field.id
                                  ? { ...item, value }
                                  : item,
                              ),
                            );
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="self-start sm:self-auto"
                          onClick={() => {
                            setMetadataFields((prev) =>
                              prev.filter((item) => item.id !== field.id),
                            );
                          }}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-dashed bg-muted/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Fees &amp; limits
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Configure Carbon gas fees and payload limits before deploying.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Gas fee base
                  </label>
                  <input
                    className="w-full rounded border px-2 py-1 font-mono"
                    inputMode="numeric"
                    value={gasFeeBase}
                    onChange={(e) => setGasFeeBase(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Gas fee (create token base)
                  </label>
                  <input
                    className="w-full rounded border px-2 py-1 font-mono"
                    inputMode="numeric"
                    value={gasFeeCreateTokenBase}
                    onChange={(e) => setGasFeeCreateTokenBase(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Gas fee (create token symbol)
                  </label>
                  <input
                    className="w-full rounded border px-2 py-1 font-mono"
                    inputMode="numeric"
                    value={gasFeeCreateTokenSymbol}
                    onChange={(e) =>
                      setGasFeeCreateTokenSymbol(e.target.value)
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Fee multiplier
                  </label>
                  <input
                    className="w-full rounded border px-2 py-1 font-mono"
                    inputMode="numeric"
                    value={gasFeeMultiplier}
                    onChange={(e) => setGasFeeMultiplier(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Max data
                  </label>
                  <input
                    className="w-full rounded border px-2 py-1 font-mono"
                    inputMode="numeric"
                    value={maxDataLimit}
                    onChange={(e) => setMaxDataLimit(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleDeploy}
                disabled={deploying || !phaCtx?.conn?.link?.account?.address || !symbol.trim()}
                className="flex items-center gap-2"
              >
                {deploying ? (
                  <>⏳ Deploying...</>
                ) : (
                  <>🚀 Deploy Token</>
                )}
              </Button>
              <Button variant="ghost" onClick={resetForm}>
                Reset
              </Button>
            </div>

            {!phaCtx?.conn?.link?.account?.address && (
              <div className="text-xs text-muted-foreground">
                ⚠️ Connect your wallet to deploy tokens
              </div>
            )}

            {phaCtx?.conn?.link?.account?.address && !symbol.trim() && (
              <div className="text-xs text-muted-foreground">
                ⚠️ Symbol is required to deploy a token
              </div>
            )}
          </CardContent>

          <CardFooter>
            <div className="w-full space-y-2 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Deployment status</div>
              {txStatus.kind === "idle" && (
                <div>No recent deployment.</div>
              )}
              {txStatus.kind === "pending" && (
                <div className="text-amber-500">
                  ⏳ Waiting for transaction confirmation for {txStatus.symbol}…
                </div>
              )}
              {txStatus.kind === "success" && (
                <div className="space-y-1">
                  <div className="text-emerald-600 flex items-center gap-1">
                    ✅ Transaction confirmed
                    {typeof txStatus.tokenId === "number" && (
                      <span className="text-xs text-muted-foreground">
                        (Token ID: {txStatus.tokenId})
                      </span>
                    )}
                  </div>
                  {txStatus.hash && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs break-all">
                        {txStatus.hash}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(txStatus.hash)
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
              {txStatus.kind === "failure" && (
                <div className="space-y-1 text-destructive">
                  <div>❌ Transaction failed: {txStatus.message}</div>
                  {txStatus.hash && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-mono text-xs break-all">
                        {txStatus.hash}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(txStatus.hash!)
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
              <div className="text-xs text-muted-foreground">
                RPC: {process.env.NEXT_PUBLIC_API_URL ?? "local"}
              </div>
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* Debug logger */}
      <DebugLogger heading="Detailed Debug Logs" logs={debugLogs} clearLogs={clearLogs} />
    </div>
  );
});

export default DeployPage;
