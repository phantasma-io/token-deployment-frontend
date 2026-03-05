import type { EasyConnect, Token } from "phantasma-sdk-ts";

export type AddLogFn = (message: string, data?: unknown) => void;

export type PhaCtxLike = {
  conn?: EasyConnect | null;
  is_connected?: boolean;
};

export type TokenActionTab = "deploy" | "series" | "mint" | "infuse" | "burn";

export type TokenSelection = {
  token: Token;
  key: string;
};
