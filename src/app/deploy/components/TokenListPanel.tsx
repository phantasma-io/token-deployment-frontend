import type { Token } from "phantasma-sdk-ts";
import { ChevronDown, RefreshCw, Coins, Lock, Inbox, Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { getTokenPrimary, isTokenNFT } from "../utils/tokenHelpers";

type TokenListPanelProps = {
  tokens: Token[];
  loading: boolean;
  currentPage: number;
  pageSize: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onToggleExpanded: (key: string) => void;
  expandedTokens: Record<string, boolean>;
  onRefresh: () => void;
  hasWalletAddress: boolean;
  canSelectToken: boolean;
  selectedTokenKey: string | null;
  onSelectToken: (token: Token, key: string) => void;
  isTokenSelectable?: (token: Token) => boolean;
  selectionDisabledMessage?: string;
};

export function TokenListPanel({
  tokens,
  loading,
  currentPage,
  pageSize,
  onPrevPage,
  onNextPage,
  onToggleExpanded,
  expandedTokens,
  onRefresh,
  hasWalletAddress,
  canSelectToken,
  selectedTokenKey,
  onSelectToken,
  isTokenSelectable,
  selectionDisabledMessage,
}: TokenListPanelProps) {
  const totalPages = Math.max(1, Math.ceil(tokens.length / pageSize));
  const paginatedTokens = tokens.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Coins size={18} />
          Your Tokens
          {hasWalletAddress && (
            <span className="text-sm font-normal text-muted-foreground">
              ({tokens.length})
            </span>
          )}
        </CardTitle>
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={loading || !hasWalletAddress}
          onClick={onRefresh}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
      </CardHeader>
      <CardContent>
        {tokens.length > 0 && (
          <div className="mb-3 flex items-center justify-end gap-3 text-xs text-muted-foreground">
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={currentPage <= 1}
                onClick={onPrevPage}
              >
                Prev
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={currentPage >= totalPages}
                onClick={onNextPage}
              >
                Next
              </Button>
            </div>
          </div>
        )}

            {!hasWalletAddress ? (
              <div className="text-center py-8 space-y-2">
                <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">
                  Connect your wallet to view and deploy tokens
                </div>
              </div>
            ) : loading ? (
              <div className="text-center py-4 space-y-2">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                <div className="text-sm">Loading tokens...</div>
              </div>
            ) : tokens.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">
                  No tokens found for this address
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Deploy your first token using the form →
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {paginatedTokens.map((token, idx) => {
              const primary = getTokenPrimary(
                token,
                `#${(currentPage - 1) * pageSize + idx}`,
              );
              const isExpanded = !!expandedTokens[primary];
              const isSelected = selectedTokenKey === primary;
              const isNFTItem = isTokenNFT(token);
              const selectable =
                !isTokenSelectable || isTokenSelectable(token);

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
                        onClick={() => onToggleExpanded(primary)}
                        className="border border-transparent text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          size={16}
                          className={`transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </Button>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-lg">
                            {primary}
                          </span>
                          <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                            {isNFTItem ? "NFT" : "Fungible"}
                          </span>
                        </div>
                        {isExpanded && token?.name && (
                          <div className="text-sm text-muted-foreground mt-1">
                            {token.name}
                          </div>
                        )}
                      </div>
                    </div>
                    {canSelectToken && (
                      <Button
                        type="button"
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        disabled={!selectable}
                        title={!selectable ? selectionDisabledMessage : undefined}
                        onClick={() => {
                          if (!selectable) return;
                          onSelectToken(token, primary);
                        }}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </Button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs text-muted-foreground space-y-1">
                        {token?.name && <div>Name: {token.name}</div>}
                        {token?.currentSupply && (
                          <div>Current Supply: {token.currentSupply}</div>
                        )}
                        {token?.maxSupply && (
                          <div>Max Supply: {token.maxSupply}</div>
                        )}
                        <div>Decimals: {token?.decimals}</div>
                      </div>
                      <pre className="max-h-48 max-w-full overflow-auto rounded border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">
                        {JSON.stringify(token, null, 2)}
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
  );
}
