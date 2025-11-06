export function ensureError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : JSON.stringify(err));
}

export function toMessage(err: unknown): string {
  return ensureError(err).message;
}

