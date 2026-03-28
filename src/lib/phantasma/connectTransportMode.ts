export type StoredConnectTransportMode = "auto" | "injected" | "local-socket";

const CONNECT_TRANSPORT_MODE_STORAGE_KEY = "token-deployment-frontend.connect-transport-mode";

export function normalizeConnectTransportMode(
  value: string | null | undefined,
): StoredConnectTransportMode {
  switch (value) {
    case "auto":
    case "injected":
    case "local-socket":
      return value;
    default:
      return "auto";
  }
}

export function readStoredConnectTransportMode(): StoredConnectTransportMode {
  if (typeof window === "undefined") {
    return "auto";
  }

  try {
    return normalizeConnectTransportMode(
      window.localStorage.getItem(CONNECT_TRANSPORT_MODE_STORAGE_KEY),
    );
  } catch {
    return "auto";
  }
}

export function writeStoredConnectTransportMode(
  value: string,
): StoredConnectTransportMode {
  const normalized = normalizeConnectTransportMode(value);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CONNECT_TRANSPORT_MODE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage failures; the in-memory state is still the source of truth
      // for the current page session.
    }
  }

  return normalized;
}
