import type { Token } from "phantasma-sdk-ts";

export type AddLogFn = (message: string, data?: unknown) => void;

export type TokenActionTab =
  | "deploy"
  | "contract"
  | "series"
  | "mint"
  | "infuse"
  | "burn";

export type TokenSelection = {
  token: Token;
  key: string;
};
