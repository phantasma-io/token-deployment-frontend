export function normalizeImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.toString();
  } catch {
    return null;
  }
}
