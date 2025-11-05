// Lightweight local storage store for token schemas JSON
// Used to persist builder state across tabs (e.g., mint flow)

const STORAGE_KEY = "pha.tokenSchemasJson";

export type TokenSchemasJsonShape = {
  seriesMetadata: { name: string; type: string }[];
  rom: { name: string; type: string }[];
  ram: { name: string; type: string }[];
};

export function getTokenSchemasJson(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && raw.length ? raw : null;
  } catch {
    return null;
  }
}

export function setTokenSchemasJson(json: string | TokenSchemasJsonShape | null) {
  if (typeof window === "undefined") return;
  try {
    if (json === null) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const raw = typeof json === "string" ? json : JSON.stringify(json);
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // ignore
  }
}

