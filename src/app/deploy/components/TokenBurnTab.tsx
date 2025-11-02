import type { Token } from "phantasma-sdk-ts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getTokenPrimary, isTokenNFT } from "../utils/tokenHelpers";

type TokenBurnTabProps = {
  selectedToken: Token | null;
};

export function TokenBurnTab({ selectedToken }: TokenBurnTabProps) {
  if (!selectedToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a token to burn</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Choose a token from the list to configure burn operations. Burning
            reduces supply for fungible tokens or destroys specific NFT items.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tokenPrimary = getTokenPrimary(selectedToken, selectedToken.symbol);
  const nft = isTokenNFT(selectedToken);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Burn {nft ? "NFT items" : "fungible supply"} from{" "}
          <span className="font-mono">{tokenPrimary}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Detected token type:{" "}
          <span className="font-semibold text-foreground">
            {nft ? "NFT" : "Fungible"}
          </span>
        </p>
        <p>
          Burn controls will be implemented here. The UI will adapt to NFT or
          fungible flows accordingly.
        </p>
      </CardContent>
    </Card>
  );
}
