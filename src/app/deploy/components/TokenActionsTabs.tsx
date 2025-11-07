import { useRef } from "react";
import type { Token } from "phantasma-sdk-ts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { AddLogFn, TokenActionTab } from "../types";
import { Rocket } from "lucide-react";

import { TokenDeploymentForm, type TokenDeploymentFormHandle } from "./TokenDeploymentForm";
import { TokenSeriesTab } from "./TokenSeriesTab";
import { TokenMintTab } from "./TokenMintTab";
import { TokenInfuseTab } from "./TokenInfuseTab";
import { TokenBurnTab } from "./TokenBurnTab";

const tabs: Array<{ key: TokenActionTab; label: string }> = [
  { key: "deploy", label: "Deploy" },
  { key: "series", label: "Series" },
  { key: "mint", label: "Mint" },
  { key: "infuse", label: "Infuse" },
  { key: "burn", label: "Burn" },
];

type TokenActionsTabsProps = {
  activeTab: TokenActionTab;
  onTabChange: (tab: TokenActionTab) => void;
  phaCtx: any;
  addLog: AddLogFn;
  onRefreshTokens: (ownerAddress: string) => Promise<void>;
  expandToken: (tokenKey: string) => void;
  selectedToken: Token | null;
};

export function TokenActionsTabs({
  activeTab,
  onTabChange,
  phaCtx,
  addLog,
  onRefreshTokens,
  expandToken,
  selectedToken,
}: TokenActionsTabsProps) {
  const deployFormRef = useRef<TokenDeploymentFormHandle | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            variant={activeTab === tab.key ? "default" : "outline"}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "deploy" && (
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Rocket size={18} />
                Deploy New Token
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Create a new Carbon token on Phantasma blockchain
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => deployFormRef.current?.reset()}>
              Reset
            </Button>
          </CardHeader>
          <CardContent>
            <TokenDeploymentForm
              ref={deployFormRef}
              phaCtx={phaCtx}
              addLog={addLog}
              onRefreshTokens={onRefreshTokens}
              expandToken={expandToken}
            />
          </CardContent>
        </Card>
      )}

      {activeTab === "series" && (
        <TokenSeriesTab selectedToken={selectedToken} phaCtx={phaCtx} addLog={addLog} />
      )}

      {activeTab === "mint" && (
        <TokenMintTab selectedToken={selectedToken} phaCtx={phaCtx} addLog={addLog} />
      )}

      {activeTab === "infuse" && (
        <TokenInfuseTab selectedToken={selectedToken} />
      )}

      {activeTab === "burn" && <TokenBurnTab selectedToken={selectedToken} />}
    </div>
  );
}
