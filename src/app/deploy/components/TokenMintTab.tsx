import type { Token } from "phantasma-sdk-ts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getTokenPrimary, isTokenNFT } from "../utils/tokenHelpers";

type TokenMintTabProps = {
  selectedToken: Token | null;
};

export function TokenMintTab({ selectedToken }: TokenMintTabProps) {
  if (!selectedToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a token to mint</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Choose a token from the list to prepare mint transactions. The form
            will adjust automatically for fungible or NFT assets.
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
          Mint {nft ? "NFT items" : "fungible supply"} for{" "}
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
          Minting controls will appear here in the next iteration. For now, this
          placeholder confirms token selection and type-specific handling.
        </p>
      </CardContent>
    </Card>
  );
}
