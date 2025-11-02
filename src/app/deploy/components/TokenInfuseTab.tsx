import type { Token } from "phantasma-sdk-ts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getTokenPrimary } from "../utils/tokenHelpers";

type TokenInfuseTabProps = {
  selectedToken: Token | null;
};

export function TokenInfuseTab({ selectedToken }: TokenInfuseTabProps) {
  if (!selectedToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select an NFT token to infuse</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Choose an NFT token (not a specific item yet) from the list to
            perform infusion. Infusion allows embedding other NFTs or
            fungible tokens inside the NFT.
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
          Infuse NFT <span className="font-mono">{tokenPrimary}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Infusion controls will be implemented here. This placeholder confirms
          the selected NFT that will receive embedded assets.
        </p>
      </CardContent>
    </Card>
  );
}
