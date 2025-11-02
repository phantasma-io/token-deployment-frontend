import type { Token } from "phantasma-sdk-ts";

export type AddLogFn = (message: string, data?: any) => void;

export type TokenActionTab = "deploy" | "series" | "mint" | "infuse" | "burn";

export type TokenSelection = {
  token: Token;
  key: string;
};
