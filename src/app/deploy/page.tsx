"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import {
  PhaAccountWidgetV1,
  PhaConnectCtx,
  type LinkTransportMode,
} from "@phantasma/connect-react";
import { ChevronDown } from "lucide-react";
import { observer } from "mobx-react-lite";
import type { Token } from "phantasma-sdk-ts";

import { ThemeToggle } from "@/components/ThemeToggle";
import { DebugLogger } from "@/components/DebugLogger";
import { Button } from "@/components/ui/button";
import { writeStoredConnectTransportMode } from "@/lib/phantasma/connectTransportMode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { TokenListPanel } from "./components/TokenListPanel";
import { TokenActionsTabs } from "./components/TokenActionsTabs";
import { useTokenInventory } from "./hooks/useTokenInventory";
import type { TokenActionTab } from "./types";
import { getTokenPrimary, isTokenNFT } from "./utils/tokenHelpers";

const PAGE_SIZE = 10;
const TRANSPORT_MODE_OPTIONS: Array<{
  value: LinkTransportMode;
  buttonLabel: string;
  menuLabel: string;
}> = [
  { value: "auto", buttonLabel: "Auto", menuLabel: "Auto detect" },
  { value: "injected", buttonLabel: "Extension", menuLabel: "Browser extension" },
  { value: "local-socket", buttonLabel: "Wallet", menuLabel: "Standalone wallet" },
];

function getTransportModeMenuLabel(value: LinkTransportMode) {
  return (
    TRANSPORT_MODE_OPTIONS.find((option) => option.value === value)?.menuLabel ?? value
  );
}

function supportsTokenSelection(tab: TokenActionTab) {
  return tab !== "deploy";
}

function isNftOnlyTab(tab: TokenActionTab) {
  return tab === "series" || tab === "infuse";
}

const DeployPage = observer(() => {
  const phaCtx = useContext(PhaConnectCtx);

  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TokenActionTab>("deploy");
  const [selectedTokenKey, setSelectedTokenKey] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);

  const addLog = useCallback((message: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}${data ? "\n" + JSON.stringify(data, null, 2) : ""}`;
    console.log(message, data);
    setDebugLogs((prev) => [...prev, logEntry]);
  }, []);

  const clearLogs = useCallback(() => setDebugLogs([]), []);

  const {
    tokens,
    loadingTokens,
    expandedTokens,
    currentPage,
    setCurrentPage,
    loadTokens,
    toggleExpanded,
    expandToken,
    clearTokens,
  } = useTokenInventory(addLog, PAGE_SIZE);

  const walletAddress = phaCtx?.conn?.link?.account?.address ?? null;
  const hasInjectedLinkSocket =
    typeof window !== "undefined" && "PhantasmaLinkSocket" in window;
  const linkDiagnostics = phaCtx?.last_connect_diagnostics ?? null;
  const selectedTransportMode = phaCtx?.selected_transport_mode ?? "auto";
  const availableTransports = phaCtx?.available_transports ?? [];
  const selectedTransportModeOption =
    TRANSPORT_MODE_OPTIONS.find((option) => option.value === selectedTransportMode) ??
    TRANSPORT_MODE_OPTIONS[0];
  const tokenSelectionEnabled = supportsTokenSelection(activeTab);
  const nftOnlyTab = isNftOnlyTab(activeTab);
  const isTokenSelectable = useCallback(
    (token: Token) => {
      if (nftOnlyTab) {
        return isTokenNFT(token);
      }
      return true;
    },
    [nftOnlyTab],
  );

  // Track connect-react state transitions so wallet-link failures show up in the on-page logger.
  useEffect(() => {
    addLog("[effect] useEffect triggered - checking wallet connection", {
      is_connecting: phaCtx?.is_connecting,
      is_connected: phaCtx?.is_connected,
      err_msg: phaCtx?.err_msg,
      injected_link_socket: hasInjectedLinkSocket,
      selected_transport_mode: selectedTransportMode,
      available_transports_state: availableTransports,
      configured_transport_mode: linkDiagnostics?.configured_transport_mode ?? null,
      requested_transport_mode: linkDiagnostics?.requested_transport_mode ?? null,
      available_transports: linkDiagnostics?.available_transports ?? [],
      attempted_transports: linkDiagnostics?.attempted_transports ?? [],
      selected_transport: linkDiagnostics?.selected_transport ?? null,
      fallback_used: linkDiagnostics?.fallback_used ?? false,
      fallback_from: linkDiagnostics?.fallback_from ?? null,
      fallback_to: linkDiagnostics?.fallback_to ?? null,
      selection_reason: linkDiagnostics?.selection_reason ?? null,
      failure_class: linkDiagnostics?.failure_class ?? null,
      failure_message: linkDiagnostics?.failure_message ?? null,
      local_socket_reachable: linkDiagnostics?.local_socket_reachable ?? null,
      injected_transport_detected: linkDiagnostics?.injected_transport_detected ?? null,
      socket_transport: linkDiagnostics?.socket_transport ?? null,
      socket_open: linkDiagnostics?.socket_open ?? null,
      conn_exists: !!phaCtx?.conn,
      link_exists: !!phaCtx?.conn?.link,
      account_exists: !!phaCtx?.conn?.link?.account,
      address: walletAddress,
      full_phaCtx: {
        ...phaCtx,
        last_connect_diagnostics: linkDiagnostics,
        conn: phaCtx?.conn
          ? {
              connected: phaCtx.conn.connected,
              platform: phaCtx.conn.platform,
              sdkProviderHint: phaCtx.conn.providerHint,
              linkTransport: phaCtx.conn.link?.socketTransport ?? null,
              linkSocketOpen: phaCtx.conn.link?.socketOpen ?? null,
              link: phaCtx.conn.link
                ? {
                    account: {
                      address: phaCtx.conn.link.account?.address,
                      name: phaCtx.conn.link.account?.name,
                    },
                  }
                : null,
            }
          : null,
      },
    });

    if (!walletAddress) {
      addLog("[error] No wallet address found, clearing tokens");
      clearTokens();
      setSelectedToken(null);
      setSelectedTokenKey(null);
      return;
    }

    addLog("[success] Wallet address found, loading tokens", { address: walletAddress });
    void loadTokens(walletAddress).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    phaCtx?.is_connecting,
    phaCtx?.is_connected,
    phaCtx?.err_msg,
    walletAddress,
    selectedTransportMode,
    availableTransports,
  ]);

  useEffect(() => {
    if (!phaCtx?.err_msg) {
      return;
    }

    addLog("[wallet][error] Wallet connect failure reported by connect-react", {
      err_msg: phaCtx.err_msg,
      injected_link_socket: hasInjectedLinkSocket,
      last_connect_diagnostics: linkDiagnostics,
      is_connecting: phaCtx.is_connecting,
      is_connected: phaCtx.is_connected,
    });
  }, [phaCtx?.err_msg, phaCtx?.is_connecting, phaCtx?.is_connected, hasInjectedLinkSocket, linkDiagnostics, addLog]);

  const handlePrevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  }, [setCurrentPage]);

  const handleNextPage = useCallback(() => {
    const totalPages = Math.max(1, Math.ceil(tokens.length / PAGE_SIZE));
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));
  }, [setCurrentPage, tokens.length]);

  const handleRefreshTokens = useCallback(() => {
    if (!walletAddress) return;
    addLog("[action] Refresh button clicked", { address: walletAddress });
    void loadTokens(walletAddress).catch(() => undefined);
  }, [walletAddress, addLog, loadTokens]);

  const handleTransportModeChange = useCallback(
    (nextMode: string) => {
      const resolvedMode = writeStoredConnectTransportMode(nextMode) as LinkTransportMode;
      if (resolvedMode === selectedTransportMode) {
        return;
      }

      phaCtx?.set_transport_mode(resolvedMode);
      addLog("[wallet][transport] Connect mode changed", {
        selected_transport_mode: resolvedMode,
        available_transports: phaCtx?.available_transports ?? [],
        is_connecting: phaCtx?.is_connecting ?? false,
        is_connected: phaCtx?.is_connected ?? false,
      });
    },
    [addLog, phaCtx, selectedTransportMode],
  );

  const handleSelectToken = useCallback(
    (token: Token, key: string) => {
      if (isNftOnlyTab(activeTab) && !isTokenNFT(token)) {
        addLog("[warn] Ignoring selection of fungible token in NFT-only tab", {
          key,
          symbol: token?.symbol,
          tab: activeTab,
        });
        return;
      }
      setSelectedToken(token);
      setSelectedTokenKey(key);
      addLog("[select] Token selected for actions", {
        key,
        symbol: token?.symbol,
        name: token?.name,
      });
    },
    [addLog, activeTab],
  );

  useEffect(() => {
    if (!selectedTokenKey) {
      if (selectedToken !== null) {
        setSelectedToken(null);
      }
      return;
    }

    const match = tokens.find((token) => {
      const primary = getTokenPrimary(token, token?.symbol ?? "");
      if (primary === selectedTokenKey) return true;
      if (token?.symbol && token.symbol === selectedTokenKey) return true;
      if (selectedToken?.address && token?.address === selectedToken.address) {
        return true;
      }
      return false;
    });

    if (!match) {
      if (selectedTokenKey !== null) {
        setSelectedTokenKey(null);
      }
      if (selectedToken !== null) {
        setSelectedToken(null);
      }
      return;
    }

    if (nftOnlyTab && match && !isTokenNFT(match)) {
      if (selectedTokenKey !== null) {
        setSelectedTokenKey(null);
      }
      if (selectedToken !== null) {
        setSelectedToken(null);
      }
      return;
    }

    if (selectedToken !== match) {
      setSelectedToken(match);
    }
  }, [tokens, selectedTokenKey, selectedToken, nftOnlyTab]);

  useEffect(() => {
    if (!tokenSelectionEnabled) {
      if (selectedTokenKey !== null || selectedToken !== null) {
        addLog("[cleanup] Clearing token selection for non-token-action tab", {
          tab: activeTab,
        });
      }
      if (selectedTokenKey !== null) {
        setSelectedTokenKey(null);
      }
      if (selectedToken !== null) {
        setSelectedToken(null);
      }
      return;
    }

    if (nftOnlyTab && selectedToken && !isTokenNFT(selectedToken)) {
      addLog("[warn] NFT-only tab, clearing fungible selection", {
        symbol: selectedToken.symbol,
        tab: activeTab,
      });
      setSelectedToken(null);
      setSelectedTokenKey(null);
    }
  }, [activeTab, tokenSelectionEnabled, nftOnlyTab, selectedTokenKey, selectedToken, addLog]);

  const handleTabChange = useCallback(
    (tab: TokenActionTab) => {
      setActiveTab(tab);
      addLog("[nav] Action tab changed", { tab });
    },
    [addLog],
  );

  const refreshTokens = useCallback(
    async (address: string) => {
      await loadTokens(address);
    },
    [loadTokens],
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-rose-100/40 via-background to-background dark:from-rose-900/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              PHANTASMA NETWORK
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Deployment Studio
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Deploy Carbon tokens and pre-compiled Phantasma contracts
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-2 shadow-sm backdrop-blur">
              <PhaAccountWidgetV1 state={phaCtx} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={phaCtx?.is_connecting}
                    aria-label="Wallet transport mode"
                    title={`Wallet transport mode. Detected: ${availableTransports.length > 0 ? availableTransports.map(getTransportModeMenuLabel).join(", ") : "none"}`}
                    className="h-8 min-w-0 rounded-full px-2.5 text-[11px] shadow-xs"
                  >
                    <span>{selectedTransportModeOption.buttonLabel}</span>
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[12rem]">
                  <DropdownMenuLabel>Connect mode</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={selectedTransportMode}
                    onValueChange={handleTransportModeChange}
                  >
                    {TRANSPORT_MODE_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.menuLabel}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <TokenListPanel
            tokens={tokens}
            loading={loadingTokens}
            currentPage={currentPage}
            pageSize={PAGE_SIZE}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            onToggleExpanded={toggleExpanded}
            expandedTokens={expandedTokens}
            onRefresh={handleRefreshTokens}
            hasWalletAddress={!!walletAddress}
            canSelectToken={tokenSelectionEnabled}
            selectedTokenKey={tokenSelectionEnabled ? selectedTokenKey : null}
            onSelectToken={handleSelectToken}
            isTokenSelectable={tokenSelectionEnabled ? isTokenSelectable : undefined}
            selectionDisabledMessage={
              activeTab === "series"
                ? "Series can only be created for NFT tokens"
                : activeTab === "infuse"
                  ? "Infusion is only supported for NFT tokens"
                  : undefined
            }
          />
          <TokenActionsTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            phaCtx={phaCtx}
            addLog={addLog}
            onRefreshTokens={refreshTokens}
            expandToken={expandToken}
            selectedToken={tokenSelectionEnabled ? selectedToken : null}
          />
        </div>

        <DebugLogger heading="Detailed Debug Logs" logs={debugLogs} clearLogs={clearLogs} />
      </div>
    </div>
  );
});

export default DeployPage;
