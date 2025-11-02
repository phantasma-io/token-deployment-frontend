import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Plus, Trash2 } from "lucide-react";
import { CreateTokenFeeOptions, TokenInfoBuilder } from "phantasma-sdk-ts";

import { Button } from "@/components/ui/button";

import { deployCarbonToken } from "@/lib/phantasmaClient";

import type { AddLogFn } from "../types";

type TokenDeploymentFormProps = {
  phaCtx: any;
  addLog: AddLogFn;
  onRefreshTokens: (ownerAddress: string) => Promise<void>;
  expandToken: (tokenKey: string) => void;
};

type MetadataField = { id: number; key: string; value: string };

type TxStatus =
  | { kind: "idle" }
  | { kind: "pending"; symbol: string }
  | { kind: "success"; hash: string; tokenId?: number }
  | { kind: "failure"; message: string; hash?: string };

const ALLOWED_ICON_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
]);

type IconValidationResult =
  | { ok: true; mimeType: string }
  | { ok: false; error: string };

function validateIconDataUri(dataUri: string): IconValidationResult {
  const trimmed = dataUri.trim();
  if (!trimmed) {
    return { ok: false, error: "Icon data URI cannot be empty" };
  }

  const match = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      error:
        "Icon must be a valid data URI (data:[mime];base64,...)",
    };
  }

  const mimeType = match[1];
  const base64Payload = match[2];

  if (!ALLOWED_ICON_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      error: `Unsupported icon mime type: ${mimeType}`,
    };
  }

  if (!base64Payload || base64Payload.length === 0) {
    return {
      ok: false,
      error: "Icon data URI payload is empty",
    };
  }

  try {
    // Ensure base64 payload decodes successfully.
    // eslint-disable-next-line no-unused-vars
    const _decoded = atob(base64Payload);
  } catch {
    return {
      ok: false,
      error: "Icon data URI payload is not valid base64",
    };
  }

  return { ok: true, mimeType };
}

function parseBigIntField(raw: string, label: string, allowEmpty = false) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    if (allowEmpty) return 0n;
    throw new Error(`${label} is required`);
  }
  try {
    const value = BigInt(trimmed);
    if (value < 0n) {
      throw new Error(`${label} must be non-negative`);
    }
    return value;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : `Invalid value for ${label}`;
    throw new Error(message);
  }
}

export function TokenDeploymentForm({
  phaCtx,
  addLog,
  onRefreshTokens,
  expandToken,
}: TokenDeploymentFormProps) {
  const [isNFT, setIsNFT] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [description, setDescription] = useState("");
  const [decimals, setDecimals] = useState<number>(8);
  const [lastFungibleDecimals, setLastFungibleDecimals] = useState<number>(8);
  const [maxSupply, setMaxSupply] = useState<string>("0");
  const [gasFeeBase, setGasFeeBase] = useState("10000");
  const [gasFeeCreateTokenBase, setGasFeeCreateTokenBase] =
    useState("10000000000");
  const [gasFeeCreateTokenSymbol, setGasFeeCreateTokenSymbol] =
    useState("10000000000");
  const [gasFeeMultiplier, setGasFeeMultiplier] = useState("10000");
  const [maxDataLimit, setMaxDataLimit] = useState("1000000000");
  const [iconDataUri, setIconDataUri] = useState<string | null>(null);
  const [iconFileName, setIconFileName] = useState<string | null>(null);
  const [iconInputMode, setIconInputMode] = useState<"file" | "manual">("file");
  const [manualIconInput, setManualIconInput] = useState("");
  const [manualIconError, setManualIconError] = useState<string | null>(null);
  const [metadataFields, setMetadataFields] = useState<MetadataField[]>([]);
  const [metadataIdCounter, setMetadataIdCounter] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>({ kind: "idle" });

  const walletAddress = phaCtx?.conn?.link?.account?.address;
  const trimmedSymbol = symbol.trim();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const symbolValidation = useMemo(() => {
    if (!trimmedSymbol) {
      return { ok: false, error: null };
    }
    return TokenInfoBuilder.checkIsValidSymbol(trimmedSymbol);
  }, [trimmedSymbol]);

  const resetForm = useCallback(() => {
    setSymbol("");
    setName("");
    setTokenUrl("");
    setDescription("");
    setDecimals(8);
    setLastFungibleDecimals(8);
    setMaxSupply("0");
    setGasFeeBase("10000");
    setGasFeeCreateTokenBase("10000000000");
    setGasFeeCreateTokenSymbol("10000000000");
    setGasFeeMultiplier("10000");
    setMaxDataLimit("1000000000");
    setIconDataUri(null);
    setIconFileName(null);
    setManualIconInput("");
    setManualIconError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setMetadataFields([]);
    setMetadataIdCounter(0);
    setIsNFT(false);
  }, []);

  const metadataFieldsMap = useMemo(() => metadataFields, [metadataFields]);

  const handleDeploy = useCallback(async () => {
    addLog("🚀 handleDeploy started", {
      symbol: trimmedSymbol,
      name,
      url: tokenUrl,
      description,
      isNFT,
      decimals,
      maxSupply,
      has_icon: !!iconDataUri,
      metadata_fields: metadataFieldsMap,
      wallet_connected: !!phaCtx?.conn,
      owner_address: walletAddress,
    });

    if (!phaCtx?.conn) {
      addLog("❌ No wallet connection");
      toast.error("Connect wallet first");
      return;
    }
    if (!trimmedSymbol) {
      addLog("❌ Symbol is required");
      toast.error("Symbol is required");
      return;
    }
    if (symbolValidation && !symbolValidation.ok) {
      addLog("❌ Symbol validation failed", { error: symbolValidation.error });
      const validationError =
        symbolValidation.error ?? "Symbol validation error: Unknown error";
      toast.error(validationError);
      return;
    }
    if (!name.trim()) {
      addLog("❌ Name is required");
      toast.error("Name is required");
      return;
    }
    if (!iconDataUri) {
      addLog("❌ Icon is required");
      toast.error("Icon is required");
      return;
    }
    if (!tokenUrl.trim()) {
      addLog("❌ URL is required");
      toast.error("URL is required");
      return;
    }
    if (!description.trim()) {
      addLog("❌ Description is required");
      toast.error("Description is required");
      return;
    }

    let maxSupplyBig: bigint;
    let maxDataBig: bigint;
    const feeConfig = new CreateTokenFeeOptions();

    try {
      maxSupplyBig = parseBigIntField(maxSupply, "Max supply", true);
      maxDataBig = parseBigIntField(maxDataLimit, "Max data", true);
      feeConfig.gasFeeBase = parseBigIntField(gasFeeBase, "Gas fee base");
      feeConfig.gasFeeCreateTokenBase = parseBigIntField(
        gasFeeCreateTokenBase,
        "Gas fee create token base",
      );
      feeConfig.gasFeeCreateTokenSymbol = parseBigIntField(
        gasFeeCreateTokenSymbol,
        "Gas fee create token symbol",
      );
      feeConfig.feeMultiplier = parseBigIntField(
        gasFeeMultiplier,
        "Gas fee multiplier",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("❌ Fee/max parse failed", { error: message });
      toast.error(message);
      return;
    }

    addLog("⚙️ Fee configuration parsed", {
      gasFeeBase: feeConfig.gasFeeBase.toString(),
      gasFeeCreateTokenBase: feeConfig.gasFeeCreateTokenBase.toString(),
      gasFeeCreateTokenSymbol: feeConfig.gasFeeCreateTokenSymbol.toString(),
      feeMultiplier: feeConfig.feeMultiplier.toString(),
      maxData: maxDataBig.toString(),
      maxSupply: maxSupplyBig.toString(),
    });

    setDeploying(true);
    toast(`Deploying ${trimmedSymbol}...`);

    try {
      const ownerAddress = walletAddress;
      if (!ownerAddress) {
        throw new Error("Wallet address is missing");
      }

      const metadataObj: Record<string, string> = {
        name: name.trim(),
        icon: iconDataUri,
        url: tokenUrl.trim(),
        description: description.trim(),
      };
      metadataFields.forEach(({ key, value }) => {
        const trimmedKey = key.trim();
        if (!trimmedKey) return;
        if (
          trimmedKey === "name" ||
          trimmedKey === "icon" ||
          trimmedKey === "url" ||
          trimmedKey === "description"
        ) {
          throw Error(
            `Reserved key cannot be used for extended properties ${trimmedKey}`,
          );
        }
        metadataObj[trimmedKey] = value;
      });

      const metadata =
        Object.keys(metadataObj).length > 0 ? metadataObj : undefined;

      addLog("🧾 Compiled metadata", { metadata });

      addLog("🚀🚀 Deploying carbon token", {
        ownerAddress,
        symbol: trimmedSymbol,
        name: name.trim(),
        url: tokenUrl.trim(),
        description: description.trim(),
        isNFT,
        decimals: decimals ?? 0,
        maxSupply: maxSupplyBig.toString(),
        metadata,
        feeOptions: {
          gasFeeBase: feeConfig.gasFeeBase.toString(),
          gasFeeCreateTokenBase: feeConfig.gasFeeCreateTokenBase.toString(),
          gasFeeCreateTokenSymbol:
            feeConfig.gasFeeCreateTokenSymbol.toString(),
          feeMultiplier: feeConfig.feeMultiplier.toString(),
        },
        maxData: maxDataBig.toString(),
      });

      const res = await deployCarbonToken({
        conn: phaCtx.conn,
        ownerAddress,
        symbol: trimmedSymbol,
        name: name.trim(),
        isNFT,
        decimals: decimals ?? 0,
        maxSupply: maxSupplyBig,
        metadata,
        feeOptions: feeConfig,
        maxData: maxDataBig,
      });

      addLog("📥 deployCarbonToken response", { response: res });

      if (!res.success) {
        addLog("❌ Deploy failed", { error: res.error });
        console.error("Deploy error:", res.error);
        toast.error("Deploy failed: " + (res.error ?? "unknown"));
        setTxStatus({
          kind: "failure",
          message: res.error ?? "Transaction failure",
        });
        setDeploying(false);
        return;
      }

      addLog("✅ Deploy successful", {
        txHash: res.txHash,
        tokenId: res.tokenId,
      });
      toast.success(`Deploy TX confirmed: ${res.txHash ?? "unknown-hash"}`);
      setTxStatus({
        kind: "success",
        hash: res.txHash ?? "",
        tokenId: res.tokenId,
      });

      addLog("🔄 Refreshing tokens list after deploy");
      await onRefreshTokens(ownerAddress);

      expandToken(trimmedSymbol);
      resetForm();
      addLog("✅ Deploy process completed");
    } catch (err: any) {
      const message = err?.message ?? String(err);
      addLog("❌ Deploy exception", {
        error_message: message,
        error_name: err?.name,
        error_stack: err?.stack,
        full_error: err,
      });
      console.error("Deploy exception", err);
      toast.error("Deploy error: " + message);
      setTxStatus({ kind: "failure", message });
    } finally {
      setDeploying(false);
      addLog("🏁 handleDeploy finished");
    }
  }, [
    addLog,
    decimals,
    description,
    expandToken,
    gasFeeBase,
    gasFeeCreateTokenBase,
    gasFeeCreateTokenSymbol,
    gasFeeMultiplier,
    iconDataUri,
    isNFT,
    maxDataLimit,
    maxSupply,
    metadataFields,
    metadataFieldsMap,
    name,
    onRefreshTokens,
    phaCtx,
    resetForm,
    trimmedSymbol,
    symbolValidation,
    tokenUrl,
    walletAddress,
  ]);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">Type</label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={!isNFT ? "default" : "outline"}
            onClick={() => {
              setIsNFT(false);
              setDecimals(lastFungibleDecimals);
            }}
          >
            Fungible
          </Button>
          <Button
            type="button"
            variant={isNFT ? "default" : "outline"}
            onClick={() => {
              setIsNFT(true);
              setLastFungibleDecimals(decimals);
              setDecimals(0);
            }}
          >
            NFT
          </Button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Symbol</label>
        <input
          className="w-full rounded border px-2 py-1"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="SYMB"
        />
      </div>

      <div className="space-y-3 rounded-lg border border-dashed bg-muted/10 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Metadata
            </h3>
            <p className="text-xs text-muted-foreground">
              Populate the required Carbon metadata (name, icon, url,
              description) and add optional extras as needed.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full rounded border px-2 py-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My token name"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Icon <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium bg-background hover:bg-muted transition">
                <Upload size={16} />
                <span>Choose file</span>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    const inputEl = event.target;
                    if (!file) {
                      setIconDataUri(null);
                      setIconFileName(null);
                      inputEl.value = "";
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (loadEvt) => {
                      const result = loadEvt.target?.result;
                      if (typeof result === "string") {
                        setIconDataUri(result);
                        setIconFileName(file.name);
                        addLog("🖼️ Icon loaded", {
                          name: file.name,
                          size: file.size,
                          type: file.type,
                        });
                        setManualIconInput(result);
                        setManualIconError(null);
                      } else {
                        toast.error("Failed to read icon file");
                        setIconDataUri(null);
                        setIconFileName(null);
                      }
                      inputEl.value = "";
                    };
                    reader.onerror = () => {
                      toast.error("Failed to read icon file");
                      setIconDataUri(null);
                      setIconFileName(null);
                      inputEl.value = "";
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <div className="flex-1 rounded border bg-background px-3 py-2 text-sm">
                {iconFileName ? (
                  <span className="block truncate">{iconFileName}</span>
                ) : (
                  <span className="text-muted-foreground">
                    No file selected
                  </span>
                )}
              </div>
              {iconFileName && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIconDataUri(null);
                    setIconFileName(null);
                    setManualIconInput("");
                    setManualIconError(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <textarea
                className="w-full rounded border px-2 py-1 font-mono text-xs"
                rows={4}
                placeholder="data:image/png;base64,iVBORw0K…"
                value={manualIconInput}
                onChange={(e) => {
                  const value = e.target.value;
                  setManualIconInput(value);
                  const trimmedValue = value.trim();
                  if (!trimmedValue) {
                    setManualIconError("Icon data URI is required");
                    setIconDataUri(null);
                    setIconFileName(null);
                    return;
                  }
                  const validation = validateIconDataUri(trimmedValue);
                  if (!validation.ok) {
                    setManualIconError(validation.error);
                    setIconDataUri(null);
                    setIconFileName(null);
                    return;
                  }
                  setManualIconError(null);
                  setIconDataUri(trimmedValue);
                  setIconFileName(
                    `manual (${validation.mimeType.replace("image/", "")})`,
                  );
                }}
              />
              {manualIconError ? (
                <p className="text-xs text-amber-500">{manualIconError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paste a valid data URI (PNG, JPEG, or SVG). The payload must be base64 encoded.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium">
              URL <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full rounded border px-2 py-1"
              value={tokenUrl}
              onChange={(e) => setTokenUrl(e.target.value)}
              placeholder="https://project.example"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full rounded border px-2 py-1"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of the token purpose"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Additional metadata</label>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => {
                  setMetadataFields((prev) => [
                    ...prev,
                    { id: metadataIdCounter, key: "", value: "" },
                  ]);
                  setMetadataIdCounter((prev) => prev + 1);
                }}
              >
                <Plus size={16} />
              </Button>
            </div>
            <div className="space-y-2">
              {metadataFields.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Add optional key/value pairs if the token needs extra
                  metadata. Reserved keys (name, icon, url, description) are
                  managed above.
                </p>
              )}
              {metadataFields.map((field) => (
                <div
                  key={field.id}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                >
                  <input
                    className="w-full rounded border px-2 py-1 sm:flex-1"
                    placeholder="Key"
                    value={field.key}
                    onChange={(e) => {
                      const value = e.target.value;
                      setMetadataFields((prev) =>
                        prev.map((item) =>
                          item.id === field.id ? { ...item, key: value } : item,
                        ),
                      );
                    }}
                  />
                  <input
                    className="w-full rounded border px-2 py-1 sm:flex-1"
                    placeholder="Value"
                    value={field.value}
                    onChange={(e) => {
                      const value = e.target.value;
                      setMetadataFields((prev) =>
                        prev.map((item) =>
                          item.id === field.id ? { ...item, value } : item,
                        ),
                      );
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="self-start sm:self-auto"
                    onClick={() => {
                      setMetadataFields((prev) =>
                        prev.filter((item) => item.id !== field.id),
                      );
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            className={`block text-sm font-medium mb-1 ${isNFT ? "text-muted-foreground" : ""
              }`}
          >
            Decimals
          </label>
          <input
            type="number"
            min={0}
            className="w-full rounded border px-2 py-1"
            value={decimals}
            onChange={(e) => {
              const value = Number(e.target.value);
              setDecimals(value);
              setLastFungibleDecimals(value);
            }}
            disabled={isNFT}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Max supply</label>
          <input
            className="w-full rounded border px-2 py-1"
            value={maxSupply}
            onChange={(e) => setMaxSupply(e.target.value)}
            placeholder="0 for unlimited"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-dashed bg-muted/10 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Fees &amp; limits
            </h3>
            <p className="text-xs text-muted-foreground">
              Configure Carbon gas fees and payload limits before deploying.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              Gas fee base
            </label>
            <input
              className="w-full rounded border px-2 py-1 font-mono"
              inputMode="numeric"
              value={gasFeeBase}
              onChange={(e) => setGasFeeBase(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Gas fee (create token base)
            </label>
            <input
              className="w-full rounded border px-2 py-1 font-mono"
              inputMode="numeric"
              value={gasFeeCreateTokenBase}
              onChange={(e) => setGasFeeCreateTokenBase(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Gas fee (create token symbol)
            </label>
            <input
              className="w-full rounded border px-2 py-1 font-mono"
              inputMode="numeric"
              value={gasFeeCreateTokenSymbol}
              onChange={(e) => setGasFeeCreateTokenSymbol(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Fee multiplier
            </label>
            <input
              className="w-full rounded border px-2 py-1 font-mono"
              inputMode="numeric"
              value={gasFeeMultiplier}
              onChange={(e) => setGasFeeMultiplier(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Max data</label>
            <input
              className="w-full rounded border px-2 py-1 font-mono"
              inputMode="numeric"
              value={maxDataLimit}
              onChange={(e) => setMaxDataLimit(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleDeploy}
          disabled={
            deploying ||
            !walletAddress ||
            !trimmedSymbol ||
            (trimmedSymbol && symbolValidation && !symbolValidation.ok)
          }
          className="flex items-center gap-2"
        >
          {deploying ? <>⏳ Deploying...</> : <>🚀 Deploy Token</>}
        </Button>
        <Button variant="ghost" onClick={resetForm}>
          Reset
        </Button>
      </div>

      {!walletAddress && (
        <div className="text-xs text-muted-foreground">
          ⚠️ Connect your wallet to deploy tokens
        </div>
      )}

      {walletAddress && !trimmedSymbol && (
        <div className="text-xs text-muted-foreground">
          ⚠️ Symbol is required to deploy a token
        </div>
      )}

      {trimmedSymbol && symbolValidation && !symbolValidation.ok && (
        <div className="text-xs text-amber-500">
          ⚠️ {symbolValidation.error ?? "Symbol validation error"}
        </div>
      )}

      <div className="w-full space-y-2 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">Deployment status</div>
        {txStatus.kind === "idle" && <div>No recent deployment.</div>}
        {txStatus.kind === "pending" && (
          <div className="text-amber-500">
            ⏳ Waiting for transaction confirmation for {txStatus.symbol}…
          </div>
        )}
        {txStatus.kind === "success" && (
          <div className="space-y-1">
            <div className="text-emerald-600 flex items-center gap-1">
              ✅ Transaction confirmed
              {typeof txStatus.tokenId === "number" && (
                <span className="text-xs text-muted-foreground">
                  (Token ID: {txStatus.tokenId})
                </span>
              )}
            </div>
            {txStatus.hash && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs break-all">
                  {txStatus.hash}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(txStatus.hash)
                      .then(() => toast.success("Hash copied"))
                      .catch(() => toast.error("Copy failed"));
                  }}
                >
                  Copy
                </Button>
              </div>
            )}
          </div>
        )}
        {txStatus.kind === "failure" && (
          <div className="space-y-1 text-destructive">
            <div>❌ Transaction failed: {txStatus.message}</div>
            {txStatus.hash && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono text-xs break-all">
                  {txStatus.hash}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(txStatus.hash!)
                      .then(() => toast.success("Hash copied"))
                      .catch(() => toast.error("Copy failed"));
                  }}
                >
                  Copy
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          RPC: {process.env.NEXT_PUBLIC_API_URL ?? "local"}
        </div>
      </div>
    </div>
  );
}
