import type { Token } from "phantasma-sdk-ts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getTokenPrimary } from "../utils/tokenHelpers";

type TokenSeriesTabProps = {
  selectedToken: Token | null;
};

export function TokenSeriesTab({ selectedToken }: TokenSeriesTabProps) {
  if (!selectedToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a token to manage series</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Use the token list to choose the asset you want to extend with new
            series.
          </p>
          <p>
            Series configuration UI will appear here once a token is selected.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tokenPrimary = getTokenPrimary(selectedToken, selectedToken.symbol);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Create series for <span className="font-mono">{tokenPrimary}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>Series creation tools will be implemented here.</p>
        <p>Only NFT tokens support series; select an NFT in the list to proceed.</p>
      </CardContent>
    </Card>
  );
}
