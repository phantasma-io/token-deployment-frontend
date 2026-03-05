import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Token } from "phantasma-sdk-ts";

import { getTokens } from "@/lib/phantasmaClient";
import { ensureError } from "@/lib/phantasma/errors";

import type { AddLogFn } from "../types";

type ExpandedTokenState = Record<string, boolean>;

export function useTokenInventory(addLog: AddLogFn, pageSize = 10) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [expandedTokens, setExpandedTokens] = useState<ExpandedTokenState>({});
  const [currentPage, setCurrentPage] = useState(1);

  const resetPagination = useCallback(() => {
    setCurrentPage(1);
    setExpandedTokens({});
  }, []);

  const clearTokens = useCallback(() => {
    setTokens([]);
    resetPagination();
  }, [resetPagination]);

  const loadTokens = useCallback(
    async (ownerAddress: string) => {
      addLog("[fetch] loadTokens started", { ownerAddress });
      setLoadingTokens(true);

      try {
        addLog("[rpc] Calling getTokens API", {
          ownerAddress,
          api_url: process.env.NEXT_PUBLIC_API_URL,
          nexus: process.env.NEXT_PUBLIC_PHANTASMA_NEXUS,
        });

        const list = await getTokens(ownerAddress);

        addLog("[rpc] getTokens response received", {
          response_type: typeof list,
          is_array: Array.isArray(list),
          length: list?.length,
          first_few_items: list?.slice(0, 3),
          full_response: list,
        });

        const nextTokens = list ?? [];
        setTokens(nextTokens);
        setExpandedTokens({});
        setCurrentPage((prev) => {
          const totalPages = Math.max(
            1,
            Math.ceil(nextTokens.length / pageSize),
          );
          return Math.min(prev, totalPages);
        });
        addLog("[success] Tokens state updated", { tokens_count: (list ?? []).length });
      } catch (error: unknown) {
        const safeError = ensureError(error);
        addLog("[error] loadTokens failed", {
          error_message: safeError.message,
          error_name: safeError.name,
          error_stack: safeError.stack,
          full_error: error,
        });

        console.error("Failed to load tokens", error);
        toast.error("Failed to load tokens");
        setTokens([]);
        setExpandedTokens({});
        setCurrentPage(1);
        throw safeError;
      } finally {
        setLoadingTokens(false);
        addLog("[done] loadTokens finished");
      }
    },
    [addLog, pageSize],
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpandedTokens((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const expandToken = useCallback((key: string) => {
    setExpandedTokens((prev) => ({
      ...prev,
      [key]: true,
    }));
  }, []);

  return {
    tokens,
    loadingTokens,
    expandedTokens,
    currentPage,
    setCurrentPage,
    loadTokens,
    toggleExpanded,
    expandToken,
    resetPagination,
    clearTokens,
  };
}
