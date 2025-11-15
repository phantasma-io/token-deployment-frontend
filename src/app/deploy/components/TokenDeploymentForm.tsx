import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  Plus,
  Trash2,
  Rocket,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import {
  CreateTokenFeeOptions,
  TokenInfoBuilder,
  TokenSchemasBuilder,
  standardMetadataFields,
} from "phantasma-sdk-ts";

import { Button } from "@/components/ui/button";

import { deployCarbonToken } from "@/lib/phantasmaClient";
import { TokenSchemasBuilder as TokenSchemasBuilderUI } from "./TokenSchemasBuilder";
import { parseHumanAmountToBaseUnits, INTX_MAX_VALUE } from "../utils/decimalUnits";

import type { AddLogFn } from "../types";

type TokenDeploymentFormProps = {
  phaCtx: any;
  addLog: AddLogFn;
  onRefreshTokens: (ownerAddress: string) => Promise<void>;
  expandToken: (tokenKey: string) => void;
};

export type TokenDeploymentFormHandle = {
  reset: () => void;
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

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function estimateBase64LengthFromBytes(byteCount: number): number {
  if (byteCount <= 0) {
    return 0;
  }
  return Math.ceil(byteCount / 3) * 4;
}

function estimateDecodedBytesFromBase64(base64Payload: string): number {
  if (!base64Payload) {
    return 0;
  }
  const paddingMatch = base64Payload.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.floor((base64Payload.length / 4) * 3) - padding;
}

// Phantasma Link refuses Carbon transactions above 64 KB (65,536 hex chars) so we cap the icon payload
// to leave ~2.5 KB for the rest of the metadata after base64 expansion.
const ICON_SIZE_LIMIT_ENABLED = true;
const MAX_ICON_BASE64_PAYLOAD_CHARS = 30000;
const MAX_ICON_BINARY_BYTES = Math.floor((MAX_ICON_BASE64_PAYLOAD_CHARS / 4) * 3);
const ICON_SIZE_LIMIT_LABEL = formatBytes(MAX_ICON_BINARY_BYTES);
const ICON_PAYLOAD_LIMIT_LABEL = MAX_ICON_BASE64_PAYLOAD_CHARS.toLocaleString();

type IconValidationResult =
  | {
      ok: true;
      mimeType: string;
      base64PayloadLength: number;
      approxBinaryBytes: number;
    }
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

  const payloadLength = base64Payload.length;
  if (ICON_SIZE_LIMIT_ENABLED && payloadLength > MAX_ICON_BASE64_PAYLOAD_CHARS) {
    const approxBytes = estimateDecodedBytesFromBase64(base64Payload);
    return {
      ok: false,
      error: `Icon data is too large (${formatBytes(approxBytes)}). Base64 payloads above ${ICON_PAYLOAD_LIMIT_LABEL} characters (~${ICON_SIZE_LIMIT_LABEL}) exceed the 64 KB limit enforced by Phantasma Link.`,
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

  const approxBinaryBytes = estimateDecodedBytesFromBase64(base64Payload);

  return {
    ok: true,
    mimeType,
    base64PayloadLength: payloadLength,
    approxBinaryBytes,
  };
}

const DEFAULT_FEES_AND_LIMITS = {
  gasFeeBase: "10000",
  gasFeeCreateTokenBase: "10000000000",
  gasFeeCreateTokenSymbol: "10000000000",
  gasFeeMultiplier: "10000",
  maxDataLimit: "1000000000",
};

const DEFAULT_NFT_SCHEMAS_JSON = JSON.stringify(
  {
    seriesMetadata: [],
    rom: standardMetadataFields.map((field) => {
      const name = String(field?.name ?? "");
      return {
        name,
        type: name === "royalties" ? "Int32" : "String",
      };
    }),
    ram: [],
  },
  null,
  2,
);

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

export const TokenDeploymentForm = forwardRef<TokenDeploymentFormHandle, TokenDeploymentFormProps>(function TokenDeploymentForm(
  {
    phaCtx,
    addLog,
    onRefreshTokens,
    expandToken,
  }: TokenDeploymentFormProps,
  ref,
) {
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
  const [manualIconInput, setManualIconInput] = useState("");
  const [manualIconError, setManualIconError] = useState<string | null>(null);
  const [metadataFields, setMetadataFields] = useState<MetadataField[]>([]);
  const [metadataIdCounter, setMetadataIdCounter] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>({ kind: "idle" });
  const [tokenSchemasHasError, setTokenSchemasHasError] = useState<boolean>(false);
  const [schemasExpanded, setSchemasExpanded] = useState<boolean>(false);
  const [isSchemasDefault, setIsSchemasDefault] = useState<boolean>(true);
  const [tokenSchemasJson, setTokenSchemasJson] = useState<string>("");
  const [feesExpanded, setFeesExpanded] = useState<boolean>(false);
  const [isFeesDefault, setIsFeesDefault] = useState<boolean>(true);

  const walletAddress = phaCtx?.conn?.link?.account?.address;
  const trimmedSymbol = symbol.trim();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const symbolValidation = useMemo(() => {
    if (!trimmedSymbol) {
      return { ok: false, error: null };
    }
    return TokenInfoBuilder.checkIsValidSymbol(trimmedSymbol);
  }, [trimmedSymbol]);

  const decimalsValidation = useMemo(() => {
    if (!Number.isFinite(decimals)) {
      return { ok: false as const, error: "Decimals must be specified" };
    }
    if (!Number.isInteger(decimals)) {
      return { ok: false as const, error: "Decimals must be an integer" };
    }
    if (decimals < 0) {
      return { ok: false as const, error: "Decimals must be non-negative" };
    }
    if (decimals > 255) {
      return { ok: false as const, error: "Decimals cannot exceed 255" };
    }
    return { ok: true as const };
  }, [decimals]);

  const supplyCalculation = useMemo(() => {
    const parsed = parseHumanAmountToBaseUnits(maxSupply, decimals ?? 0, {
      label: "Max supply",
      allowEmpty: true,
      allowZero: true,
    });
    if (!parsed.ok) {
      return { ok: false as const, error: parsed.error };
    }
    if (parsed.baseUnits > INTX_MAX_VALUE) {
      return {
        ok: false as const,
        error: "Max supply exceeds the maximum supported size",
      };
    }
    return { ok: true as const, baseUnits: parsed.baseUnits };
  }, [maxSupply, decimals]);

  const resetForm = useCallback(() => {
    setSymbol("");
    setName("");
    setTokenUrl("");
    setDescription("");
    setDecimals(8);
    setLastFungibleDecimals(8);
    setMaxSupply("0");
    setGasFeeBase(DEFAULT_FEES_AND_LIMITS.gasFeeBase);
    setGasFeeCreateTokenBase(DEFAULT_FEES_AND_LIMITS.gasFeeCreateTokenBase);
    setGasFeeCreateTokenSymbol(DEFAULT_FEES_AND_LIMITS.gasFeeCreateTokenSymbol);
    setGasFeeMultiplier(DEFAULT_FEES_AND_LIMITS.gasFeeMultiplier);
    setMaxDataLimit(DEFAULT_FEES_AND_LIMITS.maxDataLimit);
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
    // Reset token schemas state to true defaults
    setTokenSchemasJson("");
    setIsSchemasDefault(true);
    setTokenSchemasHasError(false);
    setFeesExpanded(false);
    setIsFeesDefault(true);
  }, []);

  useImperativeHandle(ref, () => ({ reset: resetForm }), [resetForm]);

  useEffect(() => {
    const isDefault =
      gasFeeBase === DEFAULT_FEES_AND_LIMITS.gasFeeBase &&
      gasFeeCreateTokenBase === DEFAULT_FEES_AND_LIMITS.gasFeeCreateTokenBase &&
      gasFeeCreateTokenSymbol === DEFAULT_FEES_AND_LIMITS.gasFeeCreateTokenSymbol &&
      gasFeeMultiplier === DEFAULT_FEES_AND_LIMITS.gasFeeMultiplier &&
      maxDataLimit === DEFAULT_FEES_AND_LIMITS.maxDataLimit;
    setIsFeesDefault(isDefault);
  }, [gasFeeBase, gasFeeCreateTokenBase, gasFeeCreateTokenSymbol, gasFeeMultiplier, maxDataLimit]);

  useEffect(() => {
    if (isNFT && tokenSchemasJson.trim().length === 0) {
      setTokenSchemasJson(DEFAULT_NFT_SCHEMAS_JSON);
      setTokenSchemasHasError(false);
      setIsSchemasDefault(true);
    }
  }, [isNFT, tokenSchemasJson]);

  const metadataFieldsMap = useMemo(() => metadataFields, [metadataFields]);

  const handleDeploy = useCallback(async () => {
    addLog("[deploy] handleDeploy started", {
      symbol: trimmedSymbol,
      name,
      url: tokenUrl,
      description,
      isNFT,
      decimals,
      maxSupply,
      maxSupply_base_units: supplyCalculation.ok
        ? supplyCalculation.baseUnits.toString()
        : "invalid",
      has_icon: !!iconDataUri,
      metadata_fields: metadataFieldsMap,
      tokenSchemasJsonPresent: isNFT ? tokenSchemasJson.trim().length > 0 : false,
      wallet_connected: !!phaCtx?.conn,
      owner_address: walletAddress,
    });

    if (!phaCtx?.conn) {
      addLog("[error] No wallet connection");
      toast.error("Connect wallet first");
      return;
    }
    if (!trimmedSymbol) {
      addLog("[error] Symbol is required");
      toast.error("Symbol is required");
      return;
    }
    if (symbolValidation && !symbolValidation.ok) {
      addLog("[error] Symbol validation failed", { error: symbolValidation.error });
      const validationError =
        symbolValidation.error ?? "Symbol validation error: Unknown error";
      toast.error(validationError);
      return;
    }
    if (!decimalsValidation.ok) {
      addLog("[error] Decimals validation failed", { error: decimalsValidation.error });
      toast.error(decimalsValidation.error ?? "Invalid decimals value");
      return;
    }
    if (!supplyCalculation.ok) {
      addLog("[error] Max supply validation failed", { error: supplyCalculation.error });
      toast.error(supplyCalculation.error ?? "Invalid max supply");
      return;
    }
    if (!name.trim()) {
      addLog("[error] Name is required");
      toast.error("Name is required");
      return;
    }
    if (!iconDataUri) {
      addLog("[error] Icon is required");
      toast.error("Icon is required");
      return;
    }
    if (!tokenUrl.trim()) {
      addLog("[error] URL is required");
      toast.error("URL is required");
      return;
    }
    if (!description.trim()) {
      addLog("[error] Description is required");
      toast.error("Description is required");
      return;
    }
    if (isNFT) {
      if (tokenSchemasHasError) {
        addLog("[error] Token schemas have validation issues");
        toast.error("Fix token schemas (duplicate or reserved names)");
        return;
      }
      const js = tokenSchemasJson.trim();
      if (!js) {
        addLog("[error] Token schemas JSON is required for NFTs");
        toast.error("Token schemas are required for NFTs");
        return;
      }
      try {
        // Let SDK parse/validate JSON
        TokenSchemasBuilder.fromJson(js);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        addLog("[error] Token schemas JSON invalid", { error: msg });
        toast.error(`Invalid token schemas: ${msg}`);
        return;
      }
    }

    let maxSupplyBig: bigint;
    let maxDataBig: bigint;
    const feeConfig = new CreateTokenFeeOptions();

    try {
      maxSupplyBig = supplyCalculation.baseUnits;
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
      addLog("[error] Fee/max parse failed", { error: message });
      toast.error(message);
      return;
    }

    addLog("[info] Fee configuration parsed", {
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

      addLog("[info] Compiled metadata", { metadata });

      addLog("[deploy] Deploying carbon token", {
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
        tokenSchemasJson: isNFT ? tokenSchemasJson : undefined,
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
        tokenSchemasJson: isNFT ? tokenSchemasJson : undefined,
        feeOptions: feeConfig,
        maxData: maxDataBig,
        addLog: (message, data) => addLog(message, data),
      });

      addLog("[info] deployCarbonToken response", { response: res });

      if (!res.success) {
        addLog("[error] Deploy failed", { error: res.error });
        console.error("Deploy error:", res.error);
        toast.error("Deploy failed: " + (res.error ?? "unknown"));
        setTxStatus({
          kind: "failure",
          message: res.error ?? "Transaction failure",
        });
        setDeploying(false);
        return;
      }

      addLog("[success] Deploy successful", {
        txHash: res.txHash,
        tokenId: res.tokenId,
      });
      toast.success(`Deploy TX confirmed: ${res.txHash ?? "unknown-hash"}`);
      setTxStatus({
        kind: "success",
        hash: res.txHash ?? "",
        tokenId: res.tokenId,
      });

      addLog("[action] Refreshing tokens list after deploy");
      await onRefreshTokens(ownerAddress);

      expandToken(trimmedSymbol);
      resetForm();
      addLog("[success] Deploy process completed");
    } catch (err: any) {
      const message = err?.message ?? String(err);
      addLog("[error] Deploy exception", {
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
      addLog("[done] handleDeploy finished");
    }
  }, [
    addLog,
    decimals,
    description,
    expandToken,
    tokenSchemasHasError,
    gasFeeBase,
    gasFeeCreateTokenBase,
    gasFeeCreateTokenSymbol,
    gasFeeMultiplier,
    iconDataUri,
    isNFT,
    maxDataLimit,
    maxSupply,
    supplyCalculation,
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
    tokenSchemasJson,
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
            <div className="flex flex-col gap-3">
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
                    const estimatedPayloadChars = estimateBase64LengthFromBytes(
                      file.size,
                    );
                    if (
                      ICON_SIZE_LIMIT_ENABLED &&
                      estimatedPayloadChars > MAX_ICON_BASE64_PAYLOAD_CHARS
                    ) {
                      const message = `Icon is ${formatBytes(file.size)}, but only ${ICON_SIZE_LIMIT_LABEL} (~${ICON_PAYLOAD_LIMIT_LABEL} base64 chars) fits inside the 64 KB Carbon transaction limit enforced by Phantasma Link.`;
                      addLog("[icon] Icon rejected - file too large", {
                        name: file.name,
                        size_bytes: file.size,
                        mime: file.type,
                        estimated_base64_chars: estimatedPayloadChars,
                        max_base64_chars: MAX_ICON_BASE64_PAYLOAD_CHARS,
                      });
                      toast.error(message);
                      setIconDataUri(null);
                      setIconFileName(null);
                      inputEl.value = "";
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (loadEvt) => {
                      const result = loadEvt.target?.result;
                      if (typeof result === "string") {
                        const validation = validateIconDataUri(result);
                        if (!validation.ok) {
                          toast.error(validation.error);
                          setIconDataUri(null);
                          setIconFileName(null);
                        } else {
                          setIconDataUri(result);
                          setIconFileName(file.name);
                          addLog("[icon] Icon loaded", {
                            name: file.name,
                            size: file.size,
                            type: file.type,
                            base64_payload_chars:
                              validation.base64PayloadLength,
                            approx_binary_bytes: validation.approxBinaryBytes,
                          });
                          setManualIconInput(result);
                          setManualIconError(null);
                        }
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
              {iconDataUri && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Preview</div>
                  <div className="flex h-32 items-center justify-center rounded border bg-muted/30 p-2">
                    <img
                      src={iconDataUri}
                      alt="Token icon preview"
                      className="max-h-28 object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Icons must be PNG/JPEG/SVG data URIs under ~{ICON_SIZE_LIMIT_LABEL} (~{ICON_PAYLOAD_LIMIT_LABEL} base64 chars) so the Carbon transaction stays below the 64 KB limit enforced by Phantasma Link.
            </p>
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
                  Paste a valid data URI (PNG, JPEG, or SVG). The payload must be base64 encoded and stay under ~{ICON_SIZE_LIMIT_LABEL} to satisfy the 64 KB Phantasma Link limit.
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
          {!decimalsValidation.ok && (
            <p className="mt-1 text-xs text-amber-500">{decimalsValidation.error}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            <span className="flex items-center gap-1">
              Max supply
              <span
                className="inline-flex"
                title="Provide supply in human-readable units; it will be scaled by 10^decimals before submitting on-chain."
              >
                <Info
                  size={14}
                  className="text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
            </span>
          </label>
          <input
            className="w-full rounded border px-2 py-1"
            inputMode="decimal"
            value={maxSupply}
            onChange={(e) => setMaxSupply(e.target.value)}
            placeholder="0 for unlimited"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Example: Decimals = 1 & Max supply = 0.2 → Base units = 2.
          </p>
        </div>
        <div className="col-span-2">
          {supplyCalculation.ok ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Base units:</span>
              <span className="font-mono">
                {supplyCalculation.baseUnits.toString()}
              </span>
            </div>
          ) : maxSupply.trim().length > 0 ? (
            <div className="flex items-center gap-2 text-xs text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              {supplyCalculation.error}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Base units:</span>
              <span className="font-mono">0</span>
            </div>
          )}
        </div>
      </div>

      {isNFT && (
        <div className="space-y-3 rounded-lg border border-dashed bg-muted/10 p-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="flex items-center gap-2 text-left focus:outline-none"
              onClick={() => setSchemasExpanded((p) => !p)}
              aria-expanded={schemasExpanded}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`h-4 w-4 transition-transform ${schemasExpanded ? "rotate-180" : ""}`}
              >
                <path fillRule="evenodd" d="M12 15.75a.75.75 0 0 1-.53-.22l-5-5a.75.75 0 1 1 1.06-1.06L12 13.94l4.47-4.47a.75.75 0 0 1 1.06 1.06l-5 5a.75.75 0 0 1-.53.22z" clipRule="evenodd" />
              </svg>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Token Schemas
              </h3>
              {isSchemasDefault && (
                <span className="text-xs text-emerald-600 ml-2">Using default schemas</span>
              )}
            </button>
          </div>
          {schemasExpanded ? (
            <TokenSchemasBuilderUI
              initialPlacement="rom"
              valueJson={tokenSchemasJson}
              onChange={(json) => setTokenSchemasJson(json)}
              onStatusChange={(st) => {
                setTokenSchemasHasError(!!st?.hasError);
                setIsSchemasDefault(!!st?.isDefault);
              }}
            />
          ) : null}
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-dashed bg-muted/10 p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 text-left focus:outline-none"
            onClick={() => setFeesExpanded((p) => !p)}
            aria-expanded={feesExpanded}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className={`h-4 w-4 transition-transform ${feesExpanded ? "rotate-180" : ""}`}
            >
              <path fillRule="evenodd" d="M12 15.75a.75.75 0 0 1-.53-.22l-5-5a.75.75 0 1 1 1.06-1.06L12 13.94l4.47-4.47a.75.75 0 0 1 1.06 1.06l-5 5a.75.75 0 0 1-.53.22z" clipRule="evenodd" />
            </svg>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Fees &amp; limits
            </h3>
            {isFeesDefault && (
              <span className="text-xs text-emerald-600 ml-2">Using default fees and limits</span>
            )}
          </button>
        </div>

        {feesExpanded ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Configure Carbon gas fees and payload limits before deploying.
            </p>
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
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleDeploy}
          disabled={
            deploying ||
            !walletAddress ||
            !trimmedSymbol ||
            (symbolValidation && !symbolValidation.ok) ||
            (isNFT && tokenSchemasHasError)
          }
          className="flex items-center gap-2"
        >
          {deploying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Deploying...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" />
              Deploy Token
            </>
          )}
        </Button>
      </div>

      {!walletAddress && (
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          Connect your wallet to deploy tokens
        </div>
      )}

      {walletAddress && !trimmedSymbol && (
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          Symbol is required to deploy a token
        </div>
      )}

      {trimmedSymbol && symbolValidation && !symbolValidation.ok && (
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          {symbolValidation.error ?? "Symbol validation error"}
        </div>
      )}

      {isNFT && tokenSchemasHasError && (
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          Fix token schemas builder errors before deploying
        </div>
      )}

      <div className="w-full space-y-2 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">Deployment status</div>
        {txStatus.kind === "idle" && <div>No recent deployment.</div>}
        {txStatus.kind === "pending" && (
          <div className="flex items-center gap-2 text-amber-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for transaction confirmation for {txStatus.symbol}…
          </div>
        )}
        {txStatus.kind === "success" && (
          <div className="space-y-1">
            <div className="text-emerald-600 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Transaction confirmed
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
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Transaction failed: {txStatus.message}
            </div>
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
});
