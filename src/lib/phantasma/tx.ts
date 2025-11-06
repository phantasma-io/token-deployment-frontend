import type { PhantasmaAPI, TransactionData } from "phantasma-sdk-ts";

export type TransactionWaitOutcome =
  | { status: "success"; tx: TransactionData }
  | { status: "failure"; tx: TransactionData; message?: string }
  | { status: "timeout" };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForTransactionConfirmation(
  api: PhantasmaAPI,
  txHash: string,
  opts?: { maxAttempts?: number; delayMs?: number; failureDetailAttempts?: number },
): Promise<TransactionWaitOutcome> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 30);
  const delayMs = Math.max(100, opts?.delayMs ?? 1000);
  const failureDetailMax = Math.max(0, opts?.failureDetailAttempts ?? 6);

  let attempts = 0;
  let failureDetailAttempts = 0;

  while (attempts < maxAttempts) {
    try {
      const txInfo = await api.getTransaction(txHash);
      if (txInfo) {
        const debugComment = txInfo.debugComment;
        const resultValue = txInfo.result;

        if (txInfo.state === "Halt") {
          return { status: "success", tx: txInfo };
        }

        const stillProcessing = txInfo.state === "Running";

        if (!stillProcessing) {
          const hasDebug = typeof debugComment === "string" && debugComment.trim().length > 0;
          if (!hasDebug && failureDetailAttempts < failureDetailMax) {
            failureDetailAttempts++;
          } else {
            const message = hasDebug
              ? debugComment.trim()
              : resultValue
                ? `Execution result: ${resultValue}`
                : `State: ${txInfo.state || "unknown"}`;
            return { status: "failure", tx: txInfo, message };
          }
        }
      }
    } catch (err) {
      console.warn(`[warn] getTransaction(${txHash}) failed`, err);
    }

    attempts++;
    if (attempts < maxAttempts) {
      await delay(delayMs);
    }
  }

  return { status: "timeout" };
}

