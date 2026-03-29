"use client";

import { useState, type ChangeEvent } from "react";
import type { PhaConnectState } from "@phantasma/connect-react";
import { ProofOfWork, type Token } from "phantasma-sdk-ts";
import { toast } from "sonner";
import { FileCode2, RefreshCcw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getContractLifecycleGasDefaults,
  submitContractLifecycle,
  type ContractLifecycleFlow,
} from "@/lib/phantasma/contracts";

import type { AddLogFn } from "../types";

type ContractLifecycleTabProps = {
  phaCtx: PhaConnectState;
  addLog: AddLogFn;
  selectedToken: Token | null;
};

type GasInputs = Record<ContractLifecycleFlow, { gasPrice: string; gasLimit: string }>;

type SelectedArtifact = {
  name: string;
  bytes: Uint8Array;
};

type ContractLifecycleFlowConfig = {
  submitLabel: string;
  submittingLabel: string;
  targetLabel: string;
  targetPlaceholder: string;
  targetHelp: string;
  requiresSelectedToken: boolean;
};

const FLOW_CONFIG: Record<ContractLifecycleFlow, ContractLifecycleFlowConfig> = {
  contractDeploy: {
    submitLabel: "Deploy Contract",
    submittingLabel: "Deploying...",
    targetLabel: "Contract Name",
    targetPlaceholder: "custom_contract",
    targetHelp:
      "Uppercase token symbols belong to token-backed flows. Use Token Attach for existing tokens instead.",
    requiresSelectedToken: false,
  },
  contractUpgrade: {
    submitLabel: "Upgrade Contract",
    submittingLabel: "Upgrading...",
    targetLabel: "Contract Name",
    targetPlaceholder: "custom_contract",
    targetHelp:
      "Use the existing lowercase custom contract name. If the contract is bound to a token symbol, switch to the token-backed upgrade option.",
    requiresSelectedToken: false,
  },
  tokenAttach: {
    submitLabel: "Attach Contract",
    submittingLabel: "Attaching...",
    targetLabel: "Selected Token Symbol",
    targetPlaceholder: "Select a token from the left panel",
    targetHelp:
      "Attach uses the selected token symbol directly and does not create a new token. Select the target token on the left first.",
    requiresSelectedToken: true,
  },
  tokenUpgrade: {
    submitLabel: "Upgrade Token Contract",
    submittingLabel: "Upgrading...",
    targetLabel: "Selected Token Symbol",
    targetPlaceholder: "Select a token from the left panel",
    targetHelp:
      "The selected token symbol is reused as the contract name during upgrade, so the artifact must match that symbol.",
    requiresSelectedToken: true,
  },
};

const FLOW_SECTIONS: Array<{
  title: string;
  options: Array<{
    flow: ContractLifecycleFlow;
    label: string;
    description: string;
  }>;
}> = [
  {
    title: "Deploy",
    options: [
      {
        flow: "contractDeploy",
        label: "Custom contract",
        description: "Deploy a new standalone lowercase VM contract.",
      },
      {
        flow: "tokenAttach",
        label: "Attach contract to existing token",
        description: "Bind VM code to a token that already exists on chain.",
      },
    ],
  },
  {
    title: "Upgrade",
    options: [
      {
        flow: "contractUpgrade",
        label: "Custom contract",
        description: "Upgrade an existing standalone VM contract.",
      },
      {
        flow: "tokenUpgrade",
        label: "Token-backed contract",
        description: "Upgrade VM code already attached to an existing token.",
      },
    ],
  },
];

function parsePositiveInteger(raw: string, label: string): number {
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function parseProofOfWork(raw: string): number {
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < ProofOfWork.Minimal) {
    throw new Error(`Proof of work must be an integer >= ${ProofOfWork.Minimal}`);
  }
  return value;
}

function validateCustomContractName(contractName: string) {
  if (!/[a-z]/.test(contractName)) {
    throw new Error(
      "Custom contract names must include a lowercase letter. Use Token Attach or token-backed upgrade for uppercase token symbols.",
    );
  }
}

function createInitialGasInputs(): GasInputs {
  return {
    contractDeploy: {
      gasPrice: String(getContractLifecycleGasDefaults("contractDeploy").gasPrice),
      gasLimit: String(getContractLifecycleGasDefaults("contractDeploy").gasLimit),
    },
    contractUpgrade: {
      gasPrice: String(getContractLifecycleGasDefaults("contractUpgrade").gasPrice),
      gasLimit: String(getContractLifecycleGasDefaults("contractUpgrade").gasLimit),
    },
    tokenAttach: {
      gasPrice: String(getContractLifecycleGasDefaults("tokenAttach").gasPrice),
      gasLimit: String(getContractLifecycleGasDefaults("tokenAttach").gasLimit),
    },
    tokenUpgrade: {
      gasPrice: String(getContractLifecycleGasDefaults("tokenUpgrade").gasPrice),
      gasLimit: String(getContractLifecycleGasDefaults("tokenUpgrade").gasLimit),
    },
  };
}

export function ContractLifecycleTab({
  phaCtx,
  addLog,
  selectedToken,
}: ContractLifecycleTabProps) {
  const [flow, setFlow] = useState<ContractLifecycleFlow>("contractDeploy");
  const [customContractName, setCustomContractName] = useState("");
  const [pvmArtifact, setPvmArtifact] = useState<SelectedArtifact | null>(null);
  const [abiArtifact, setAbiArtifact] = useState<SelectedArtifact | null>(null);
  const [gasInputs, setGasInputs] = useState<GasInputs>(createInitialGasInputs);
  const [powValue, setPowValue] = useState(String(ProofOfWork.Minimal));
  const [fileInputNonce, setFileInputNonce] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const config = FLOW_CONFIG[flow];
  const currentGasInputs = gasInputs[flow];
  const selectedTokenSymbol = selectedToken?.symbol?.trim() ?? "";
  const resolvedTarget = config.requiresSelectedToken
    ? selectedTokenSymbol
    : customContractName.trim();
  const canSubmit =
    !!phaCtx?.conn &&
    !!resolvedTarget &&
    !!pvmArtifact &&
    !!abiArtifact &&
    !submitting;

  const updateGasInput = (field: "gasPrice" | "gasLimit", value: string) => {
    setGasInputs((current) => ({
      ...current,
      [flow]: {
        ...current[flow],
        [field]: value,
      },
    }));
  };

  const updateCustomContractName = (value: string) => {
    if (flow !== "contractDeploy" && flow !== "contractUpgrade") {
      return;
    }

    const normalizedValue = value.toLowerCase();
    setCustomContractName(normalizedValue);
  };

  const resetForm = () => {
    setFlow("contractDeploy");
    setCustomContractName("");
    setPvmArtifact(null);
    setAbiArtifact(null);
    setGasInputs(createInitialGasInputs());
    setPowValue(String(ProofOfWork.Minimal));
    setFileInputNonce((current) => current + 1);
  };

  const handleArtifactSelect =
    (
      kind: ".pvm" | ".abi",
      setArtifact: (artifact: SelectedArtifact | null) => void,
    ) =>
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      if (!file) {
        setArtifact(null);
        return;
      }

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setArtifact({ name: file.name, bytes });
      } catch (err: unknown) {
        setArtifact(null);
        const message = err instanceof Error ? err.message : String(err);
        addLog("[error] Contract artifact read failed", {
          flow,
          artifactKind: kind,
          fileName: file.name,
          message,
        });
        toast.error(`Failed to read ${kind} artifact: ${message}`);
      }
    };

  const handleSubmit = async () => {
    const conn = phaCtx?.conn;
    if (!conn) {
      toast.error("Connect a wallet first");
      return;
    }

    if (config.requiresSelectedToken && !selectedTokenSymbol) {
      toast.error("Select a token from the left panel first");
      return;
    }

    if (!config.requiresSelectedToken) {
      if (!resolvedTarget) {
        toast.error("Contract name is required");
        return;
      }

      try {
        validateCustomContractName(resolvedTarget);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    if (!pvmArtifact) {
      toast.error("Upload a .pvm artifact");
      return;
    }
    if (!abiArtifact) {
      toast.error("Upload a .abi artifact");
      return;
    }

    setSubmitting(true);
    try {
      const scriptBytes = pvmArtifact.bytes;
      const abiBytes = abiArtifact.bytes;

      addLog("[contract] Starting wallet transaction", {
        flow,
        contractName: resolvedTarget,
        tokenSymbol: config.requiresSelectedToken ? selectedTokenSymbol : null,
        pvmFile: pvmArtifact.name,
        abiFile: abiArtifact.name,
        scriptBytes: scriptBytes.length,
        abiBytes: abiBytes.length,
      });

      const result = await submitContractLifecycle({
        conn,
        contractName: resolvedTarget,
        tokenSymbol: config.requiresSelectedToken ? selectedTokenSymbol : undefined,
        script: scriptBytes,
        abi: abiBytes,
        flow,
        gasPrice: parsePositiveInteger(currentGasInputs.gasPrice, "Gas price"),
        gasLimit: parsePositiveInteger(currentGasInputs.gasLimit, "Gas limit"),
        proofOfWork: parseProofOfWork(powValue),
        addLog,
      });

      if (!result.success) {
        addLog("[error] Contract transaction failed", result);
        toast.error(result.error);
        return;
      }

      addLog("[success] Contract transaction confirmed", result);
      if (flow === "contractDeploy") {
        toast.success(`Contract ${resolvedTarget} deployed`);
      } else if (flow === "contractUpgrade") {
        toast.success(`Contract ${resolvedTarget} upgraded`);
      } else if (flow === "tokenAttach") {
        toast.success(`Token ${selectedTokenSymbol} contract attached`);
      } else {
        toast.success(`Token ${selectedTokenSymbol} contract upgraded`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("[error] Contract action threw", { flow, message });
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="text-sm font-semibold text-foreground">Choose contract action</div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={resetForm}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
        </div>
        <div className="mt-4 space-y-4">
          {FLOW_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-3">
              <div className="text-sm font-semibold text-foreground">{section.title}</div>
              <div className="grid gap-3 md:grid-cols-2">
                {section.options.map((option) => {
                  const selected = flow === option.flow;
                  return (
                    <button
                      key={option.flow}
                      type="button"
                      onClick={() => setFlow(option.flow)}
                      className={[
                        "rounded-xl border p-4 text-left transition",
                        selected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border/70 bg-background hover:border-foreground/30",
                      ].join(" ")}
                    >
                      <div className="text-sm font-semibold text-foreground">{option.label}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {config.requiresSelectedToken && !selectedTokenSymbol && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/20 dark:text-amber-100">
          Select a token from the left panel before submitting this flow.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">{config.targetLabel}</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none ring-0 transition focus:border-foreground/40 read-only:bg-muted/40 read-only:text-muted-foreground"
            type="text"
            placeholder={config.targetPlaceholder}
            readOnly={config.requiresSelectedToken}
            value={config.requiresSelectedToken ? selectedTokenSymbol : customContractName}
            onChange={(event) => updateCustomContractName(event.target.value)}
          />
          <div className="text-xs text-muted-foreground">{config.targetHelp}</div>
          {config.requiresSelectedToken && selectedToken && (
            <div className="text-xs text-muted-foreground">
              Selected token: {selectedToken.name?.trim() || selectedToken.symbol}
            </div>
          )}
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Proof Of Work</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none ring-0 transition focus:border-foreground/40"
            type="number"
            min={ProofOfWork.Minimal}
            step={1}
            value={powValue}
            onChange={(event) => setPowValue(event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Gas Price</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none ring-0 transition focus:border-foreground/40"
            type="number"
            min={1}
            step={1}
            value={currentGasInputs.gasPrice}
            onChange={(event) => updateGasInput("gasPrice", event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Gas Limit</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none ring-0 transition focus:border-foreground/40"
            type="number"
            min={1}
            step={1}
            value={currentGasInputs.gasLimit}
            onChange={(event) => updateGasInput("gasLimit", event.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">Compiled Script (.pvm)</span>
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Upload className="h-4 w-4" />
              Upload the ready contract bytecode produced by `pha-tomb`
            </div>
            <input
              key={`pvm-${fileInputNonce}`}
              className="block w-full text-sm"
              type="file"
              accept=".pvm,application/octet-stream"
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={handleArtifactSelect(".pvm", setPvmArtifact)}
            />
            <div
              className={[
                "mt-2 text-xs",
                pvmArtifact
                  ? "font-medium text-emerald-700 dark:text-emerald-300"
                  : "text-muted-foreground",
              ].join(" ")}
            >
              {pvmArtifact ? pvmArtifact.name : "No .pvm selected"}
            </div>
          </div>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">ABI (.abi)</span>
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <FileCode2 className="h-4 w-4" />
              Upload the compiled ABI that matches the selected `.pvm`
            </div>
            <input
              key={`abi-${fileInputNonce}`}
              className="block w-full text-sm"
              type="file"
              accept=".abi,application/octet-stream"
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={handleArtifactSelect(".abi", setAbiArtifact)}
            />
            <div
              className={[
                "mt-2 text-xs",
                abiArtifact
                  ? "font-medium text-emerald-700 dark:text-emerald-300"
                  : "text-muted-foreground",
              ].join(" ")}
            >
              {abiArtifact ? abiArtifact.name : "No .abi selected"}
            </div>
          </div>
        </label>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground shadow-sm">
        Upload compiled `.pvm` and `.abi` artifacts from `pha-tomb`, then submit them
        through the connected wallet.
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
        >
          {submitting ? config.submittingLabel : config.submitLabel}
        </Button>
      </div>
    </div>
  );
}
