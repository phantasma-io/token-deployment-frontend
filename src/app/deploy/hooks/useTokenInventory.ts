import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Token } from "phantasma-sdk-ts";

import { getTokens } from "@/lib/phantasmaClient";

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
      addLog("🔄 loadTokens started", { ownerAddress });
      setLoadingTokens(true);

      try {
        addLog("📞 Calling getTokens API", {
          ownerAddress,
          api_url: process.env.NEXT_PUBLIC_API_URL,
          nexus: process.env.NEXT_PUBLIC_PHANTASMA_NEXUS,
        });

        const list = await getTokens(ownerAddress);

        addLog("📥 getTokens response received", {
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
        addLog("✅ Tokens state updated", { tokens_count: (list ?? []).length });
      } catch (err: any) {
        addLog("❌ loadTokens failed", {
          error_message: err?.message,
          error_name: err?.name,
          error_stack: err?.stack,
          error_response: err?.response,
          error_status: err?.status,
          full_error: err,
        });

        console.error("Failed to load tokens", err);
        toast.error("Failed to load tokens");
        setTokens([]);
        setExpandedTokens({});
        setCurrentPage(1);
        throw err;
      } finally {
        setLoadingTokens(false);
        addLog("🏁 loadTokens finished");
      }
    },
    [addLog, resetPagination],
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
