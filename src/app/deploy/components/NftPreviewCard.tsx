"use client";

import { useMemo } from "react";
import type { NFT } from "phantasma-sdk-ts";

import { cn } from "@/lib/utils";

type NftPreviewCardProps = {
  nft: NFT;
  className?: string;
};

type MetadataMap = Record<string, string>;

function toMetadataMap(properties: NFT["properties"]): MetadataMap {
  const map: MetadataMap = {};
  if (Array.isArray(properties)) {
    for (const entry of properties) {
      const key = entry?.key;
      if (!key) continue;
      map[String(key)] = entry?.value != null ? String(entry.value) : "";
    }
  }
  return map;
}

const MAX_SUMMARY_LENGTH = 160;

function truncateText(value: string, limit: number) {
  if (!value) return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

export function NftPreviewCard({ nft, className }: NftPreviewCardProps) {
  const metadata = useMemo(() => toMetadataMap(nft.properties), [nft.properties]);

  const name = metadata.name?.trim() || `NFT #${nft.ID}`;
  const description = metadata.description?.trim() || "";
  const imageCandidate = metadata.imageURL || metadata.image || metadata.icon || "";
  const imageUrl =
    imageCandidate && !/^https?:\/\//i.test(imageCandidate)
      ? `https://${imageCandidate}`
      : imageCandidate;
  const shortDescription =
    description.length > 0 ? truncateText(description, MAX_SUMMARY_LENGTH) : "No description";

  const ownerShort =
    typeof nft.ownerAddress === "string" && nft.ownerAddress.length > 10
      ? `${nft.ownerAddress.slice(0, 6)}…${nft.ownerAddress.slice(-4)}`
      : nft.ownerAddress || "";

  return (
    <div className={cn("flex items-center gap-3 rounded border bg-card p-3", className)}>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="px-2 text-center text-[10px] text-muted-foreground">No image</span>
        )}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-foreground" title={name}>
          {name}
        </div>
        <div className="text-xs text-muted-foreground" title={description || undefined}>
          {shortDescription}
        </div>
        <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <span title={`Carbon NFT: ${nft.carbonNftAddress ?? "n/a"}`}>#{nft.ID}</span>
          {ownerShort && <span title={nft.ownerAddress}>Owner: {ownerShort}</span>}
        </div>
      </div>
    </div>
  );
}
