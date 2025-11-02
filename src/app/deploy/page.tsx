"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { PhaAccountWidgetV1, PhaConnectCtx } from "@phantasma/connect-react";
import { observer } from "mobx-react-lite";
import type { Token } from "phantasma-sdk-ts";

import { ThemeToggle } from "@/components/ThemeToggle";
import { DebugLogger } from "@/components/DebugLogger";

import { TokenListPanel } from "./components/TokenListPanel";
import { TokenActionsTabs } from "./components/TokenActionsTabs";
import { useTokenInventory } from "./hooks/useTokenInventory";
import type { TokenActionTab } from "./types";
import { getTokenPrimary, isTokenNFT } from "./utils/tokenHelpers";

const PAGE_SIZE = 10;

const DeployPage = observer(() => {
  const phaCtx = useContext(PhaConnectCtx);

  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TokenActionTab>("deploy");
  const [selectedTokenKey, setSelectedTokenKey] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);

  const addLog = useCallback((message: string, data?: any) => {
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
  const isTokenSelectable = useCallback(
    (token: Token) => {
      if (activeTab === "series" || activeTab === "infuse") {
        return isTokenNFT(token);
      }
      return true;
    },
    [activeTab],
  );

  useEffect(() => {
    addLog("🔄 useEffect triggered - checking wallet connection", {
      is_connected: phaCtx?.is_connected,
      conn_exists: !!phaCtx?.conn,
      link_exists: !!phaCtx?.conn?.link,
      account_exists: !!phaCtx?.conn?.link?.account,
      address: walletAddress,
      full_phaCtx: {
        ...phaCtx,
        conn: phaCtx?.conn
          ? {
              connected: phaCtx.conn.connected,
              platform: phaCtx.conn.platform,
              providerHint: phaCtx.conn.providerHint,
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
      addLog("❌ No wallet address found, clearing tokens");
      clearTokens();
      setSelectedToken(null);
      setSelectedTokenKey(null);
      return;
    }

    addLog("✅ Wallet address found, loading tokens", { address: walletAddress });
    void loadTokens(walletAddress).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaCtx?.is_connected, walletAddress]);

  const handlePrevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  }, [setCurrentPage]);

  const handleNextPage = useCallback(() => {
    const totalPages = Math.max(1, Math.ceil(tokens.length / PAGE_SIZE));
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));
  }, [setCurrentPage, tokens.length]);

  const handleRefreshTokens = useCallback(() => {
    if (!walletAddress) return;
    addLog("🔄 Refresh button clicked", { address: walletAddress });
    void loadTokens(walletAddress).catch(() => undefined);
  }, [walletAddress, addLog, loadTokens]);

  const handleSelectToken = useCallback(
    (token: Token, key: string) => {
      if ((activeTab === "series" || activeTab === "infuse") && !isTokenNFT(token)) {
        addLog("🚫 Ignoring selection of fungible token in NFT-only tab", {
          key,
          symbol: token?.symbol,
          tab: activeTab,
        });
        return;
      }
      setSelectedToken(token);
      setSelectedTokenKey(key);
      addLog("🎯 Token selected for actions", {
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

    if ((activeTab === "series" || activeTab === "infuse") && match && !isTokenNFT(match)) {
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
  }, [tokens, selectedTokenKey, selectedToken, activeTab]);

  useEffect(() => {
    if (activeTab === "deploy") {
      if (selectedTokenKey !== null || selectedToken !== null) {
        addLog("🧹 Clearing token selection for deploy tab");
      }
      if (selectedTokenKey !== null) {
        setSelectedTokenKey(null);
      }
      if (selectedToken !== null) {
        setSelectedToken(null);
      }
      return;
    }

    if (
      (activeTab === "series" || activeTab === "infuse") &&
      selectedToken &&
      !isTokenNFT(selectedToken)
    ) {
      addLog("⚠️ NFT-only tab, clearing fungible selection", {
        symbol: selectedToken.symbol,
        tab: activeTab,
      });
      setSelectedToken(null);
      setSelectedTokenKey(null);
    }
  }, [activeTab, selectedTokenKey, selectedToken, addLog]);

  const handleTabChange = useCallback(
    (tab: TokenActionTab) => {
      setActiveTab(tab);
      addLog("🧭 Action tab changed", { tab });
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
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Token Deployment</h1>
          <p className="text-muted-foreground">
            Deploy new Carbon tokens on Phantasma blockchain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PhaAccountWidgetV1 state={phaCtx} />
          <ThemeToggle />
        </div>
      </div>

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
          canSelectToken={activeTab !== "deploy"}
          selectedTokenKey={activeTab === "deploy" ? null : selectedTokenKey}
          onSelectToken={handleSelectToken}
          isTokenSelectable={activeTab !== "deploy" ? isTokenSelectable : undefined}
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
          selectedToken={activeTab === "deploy" ? null : selectedToken}
        />
      </div>

      <DebugLogger heading="Detailed Debug Logs" logs={debugLogs} clearLogs={clearLogs} />
    </div>
  );
});

export default DeployPage;
