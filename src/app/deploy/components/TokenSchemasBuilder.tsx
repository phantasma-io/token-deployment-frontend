"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Layers, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { VM_TYPE_OPTIONS } from "@/lib/carbonSchemas";
import { standardMetadataFields } from "phantasma-sdk-ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Field = { id: string; name: string; type: string; standard?: boolean };

type Placement = "series" | "rom" | "custom";

type BuilderStatus = {
  hasError: boolean;
  duplicateNames: string[];
  standardConflicts: string[];
  isDefault: boolean;
};

type TokenSchemasBuilderProps = {
  onChange?: (json: string) => void;
  onStatusChange?: (status: BuilderStatus) => void;
  initialPlacement?: Placement; // default: 'rom' (Per‑NFT)
  valueJson?: string; // controlled initial value from parent
};


// Standard metadata fields (SDK)
const STANDARD_FIELDS_ORDERED: Field[] = standardMetadataFields.map((f: any, i: number) => {
  const name = String(f.name);
  const type = name === "royalties" ? "Int32" : "String";
  return { id: `std-${i}`, name, type, standard: true };
});

const STANDARD_FIELD_NAMES = new Set(STANDARD_FIELDS_ORDERED.map((f) => f.name));


function nextId(prefix: string, n: number) {
  return `${prefix}-${n}-${Math.random().toString(36).slice(2, 6)}`;
}

export function TokenSchemasBuilder({ onChange, onStatusChange, initialPlacement = "rom", valueJson }: TokenSchemasBuilderProps) {
  const [placement, setPlacement] = useState<Placement>(initialPlacement);
  const [seriesFields, setSeriesFields] = useState<Field[]>([]);
  const [romFields, setRomFields] = useState<Field[]>([]);
  const [ramFields, setRamFields] = useState<Field[]>([]);
  const [ctr, setCtr] = useState(0);
  const initedRef = useRef(false);

  // Initialize from parent valueJson or fall back to default preset
  useEffect(() => {
    const candidate = (valueJson && valueJson.trim().length ? valueJson : null);
    if (candidate) {
      try {
        const raw = JSON.parse(candidate);
        const series: Field[] = (raw?.seriesMetadata ?? []).map((f: any, i: number) => ({ id: nextId("s", i), name: String(f.name), type: String(f.type), standard: STANDARD_FIELD_NAMES.has(String(f.name)) }));
        const rom: Field[] = (raw?.rom ?? []).map((f: any, i: number) => ({ id: nextId("r", i), name: String(f.name), type: String(f.type), standard: STANDARD_FIELD_NAMES.has(String(f.name)) }));
        const ram: Field[] = (raw?.ram ?? []).map((f: any, i: number) => ({ id: nextId("m", i), name: String(f.name), type: String(f.type) }));
        // If neither schema carries standard fields, fallback to initialPlacement default
        const stdInSeries = series.some(f => f.standard);
        const stdInRom = rom.some(f => f.standard);
        if (!stdInSeries && !stdInRom) {
          if (initialPlacement === "series") {
            setSeriesFields([...STANDARD_FIELDS_ORDERED, ...series]);
            setRomFields(rom);
          } else {
            setSeriesFields(series);
            setRomFields([...STANDARD_FIELDS_ORDERED, ...rom]);
          }
        } else {
          setSeriesFields(series);
          setRomFields(rom);
        }
        setRamFields(ram);
        setPlacement(stdInSeries && !stdInRom ? "series" : stdInRom && !stdInSeries ? "rom" : initialPlacement);
        initedRef.current = true;
        return;
      } catch {
        // fall through to default init
      }
    }
    if (initialPlacement === "series") {
      setSeriesFields([...STANDARD_FIELDS_ORDERED]);
      setRomFields([]);
    } else {
      setSeriesFields([]);
      setRomFields([...STANDARD_FIELDS_ORDERED]);
    }
    setRamFields([]);
    initedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emit JSON on changes
  const schemasJson = useMemo(() => {
    const obj = {
      seriesMetadata: seriesFields.map(({ name, type }) => ({ name, type })),
      rom: romFields.map(({ name, type }) => ({ name, type })),
      ram: ramFields.map(({ name, type }) => ({ name, type })),
    };
    const json = JSON.stringify(obj, null, 2);
    return json;
  }, [seriesFields, romFields, ramFields, onChange]);

  // Notify parent only after initial state is set
  useEffect(() => {
    if (!initedRef.current) return;
    onChange?.(schemasJson);
  }, [schemasJson]);

  // Validate names and keep placement in sync
  useEffect(() => {
    const lower = (s: string) => s.trim().toLowerCase();
    const stdNames = new Set(Array.from(STANDARD_FIELD_NAMES).map((n) => n.toLowerCase()));

    const findDuplicates = (fields: Field[]) => {
      const counts = new Map<string, number>();
      for (const f of fields) {
        const k = lower(f.name);
        if (!k) continue;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return [...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    };

    const dupSeries = findDuplicates(seriesFields);
    const dupRom = findDuplicates(romFields);
    const dupRam = findDuplicates(ramFields);
    const duplicateNames = Array.from(new Set([...dupSeries, ...dupRom, ...dupRam]));

    // cross-duplicates between Series and ROM for custom fields
    const seriesCustom = new Set(
      seriesFields
        .filter((f) => !f.standard && f.name.trim().length > 0)
        .map((f) => lower(f.name)),
    );
    const romCustom = new Set(
      romFields
        .filter((f) => !f.standard && f.name.trim().length > 0)
        .map((f) => lower(f.name)),
    );
    const crossNames: string[] = [];
    seriesCustom.forEach((n) => {
      if (romCustom.has(n)) crossNames.push(n);
    });

    const standardConflicts: string[] = [];
    const collectConflicts = (fields: Field[]) => {
      for (const f of fields) {
        if (f.standard) continue;
        const k = lower(f.name);
        if (k && stdNames.has(k)) standardConflicts.push(k);
      }
    };
    collectConflicts(seriesFields);
    collectConflicts(romFields);
    collectConflicts(ramFields);

    const hasError = duplicateNames.length > 0 || standardConflicts.length > 0 || crossNames.length > 0;
    const isDefault =
      seriesFields.length === 0 &&
      ramFields.length === 0 &&
      romFields.length === STANDARD_FIELDS_ORDERED.length &&
      romFields.every((f, idx) => f.standard && f.name === STANDARD_FIELDS_ORDERED[idx].name && f.type === STANDARD_FIELDS_ORDERED[idx].type);

    onStatusChange?.({ hasError, duplicateNames: Array.from(new Set([...duplicateNames, ...crossNames])), standardConflicts, isDefault });

    recomputePlacement(seriesFields, romFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesFields, romFields, ramFields]);

  const recomputePlacement = (series: Field[], rom: Field[]) => {
    const hasStdSeries = series.some((f) => f.standard);
    const hasStdRom = rom.some((f) => f.standard);
    if (hasStdSeries && hasStdRom) return setPlacement("custom");
    if (hasStdSeries) return setPlacement("series");
    if (hasStdRom) return setPlacement("rom");
    return setPlacement("custom");
  };

  const moveStandard = (target: Exclude<Placement, "custom">) => {
    setPlacement(target);
    if (target === "series") {
      // Remove std from ROM, add to Series (preserve their order at top)
      setRomFields((prev) => prev.filter((f) => !f.standard));
      setSeriesFields((prev) => {
        const nonStd = prev.filter((f) => !f.standard);
        return [...STANDARD_FIELDS_ORDERED, ...nonStd];
      });
    } else {
      // Remove std from Series, add to ROM
      setSeriesFields((prev) => prev.filter((f) => !f.standard));
      setRomFields((prev) => {
        const nonStd = prev.filter((f) => !f.standard);
        return [...STANDARD_FIELDS_ORDERED, ...nonStd];
      });
    }
  };

  const moveFieldBetweenSeriesAndRom = (from: "series" | "rom", id: string) => {
    if (from === "series") {
      let moved: Field | null = null;
      setSeriesFields((prev) => {
        const idx = prev.findIndex((x) => x.id === id);
        if (idx >= 0) {
          moved = prev[idx];
          return prev.filter((_, i) => i !== idx);
        }
        return prev;
      });
      if (moved) {
        setRomFields((prev) => [...prev, moved!]);
      }
      // recompute after a microtask to use latest state
      setTimeout(() => recomputePlacement(seriesFields.filter(f=>f.id!==id), [...romFields, ...(moved? [moved]:[])]), 0);
    } else {
      let moved: Field | null = null;
      setRomFields((prev) => {
        const idx = prev.findIndex((x) => x.id === id);
        if (idx >= 0) {
          moved = prev[idx];
          return prev.filter((_, i) => i !== idx);
        }
        return prev;
      });
      if (moved) {
        setSeriesFields((prev) => [...prev, moved!]);
      }
      setTimeout(() => recomputePlacement([...seriesFields, ...(moved? [moved]:[])], romFields.filter(f=>f.id!==id)), 0);
    }
    setPlacement("custom");
  };

  const TypeSelect = ({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={!!disabled} className="w-full justify-between h-8">
          <span className="truncate">{value}</span>
          <ChevronDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-60 overflow-y-auto p-1 min-w-[10rem]" align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v)}>
          {VM_TYPE_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem key={opt} value={opt} className="cursor-pointer">
              {opt}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const addField = (where: "series" | "rom" | "ram") => {
    const f: Field = { id: nextId("x", ctr), name: "customField", type: "String", standard: false };
    setCtr((n) => n + 1);
    if (where === "series") setSeriesFields((prev) => [...prev, f]);
    else if (where === "rom") setRomFields((prev) => [...prev, f]);
    else setRamFields((prev) => [...prev, f]);
  };

  const updateField = (where: "series" | "rom" | "ram", id: string, patch: Partial<Field>) => {
    const up = (arr: Field[]) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x));
    if (where === "series") setSeriesFields((prev) => up(prev));
    else if (where === "rom") setRomFields((prev) => up(prev));
    else setRamFields((prev) => up(prev));
  };

  const removeField = (where: "series" | "rom" | "ram", id: string) => {
    const rm = (arr: Field[]) => arr.filter((x) => x.id !== id);
    if (where === "series") setSeriesFields((prev) => rm(prev));
    else if (where === "rom") setRomFields((prev) => rm(prev));
    else setRamFields((prev) => rm(prev));
  };

  const resetToDefault = () => {
    setPlacement("rom");
    setSeriesFields([]);
    setRomFields([...STANDARD_FIELDS_ORDERED]);
    setRamFields([]);
  };

  const renderSchemaSection = (
    label: string,
    where: "series" | "rom" | "ram",
    fields: Field[],
  ) => (
    <Card className="border-dashed">
      <CardHeader className="py-3">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <Layers className="h-4 w-4" /> {label}
        </CardTitle>
        <CardAction>
          <Button type="button" size="sm" variant="outline" onClick={() => addField(where)}>
            <Plus className="h-4 w-4 mr-1" /> Add Field
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {fields.length === 0 ? (
          <div className="text-xs text-muted-foreground">No fields</div>
        ) : (
          <div className="space-y-2">
            {fields.map((f) => (
              <div key={f.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <input
                  className={(() => {
                    const base = "sm:col-span-5 rounded border px-2 py-1";
                    const k = f.name.trim().toLowerCase();
                    const stdNames = new Set(Array.from(STANDARD_FIELD_NAMES).map((n) => n.toLowerCase()));
                    const list = where === 'series' ? seriesFields : where === 'rom' ? romFields : ramFields;
                    const dup = k && list.some(x => x.id !== f.id && x.name.trim().toLowerCase() === k);
                    const stdConflict = !f.standard && k && stdNames.has(k);
                    const crossDup = !f.standard && k && (
                      (where === 'series' ? romFields : where === 'rom' ? seriesFields : [])
                        .some(x => !x.standard && x.name.trim().toLowerCase() === k)
                    );
                    return base + ((dup || stdConflict || crossDup) ? " border-red-500 focus-visible:ring-red-500" : "");
                  })()}
                  value={f.name}
                  onChange={(e) => updateField(where, f.id, { name: e.target.value })}
                  placeholder="name"
                  disabled={!!f.standard}
                />
                <div className="sm:col-span-5">
                  <TypeSelect
                    value={f.type}
                    onChange={(v) => updateField(where, f.id, { type: v })}
                    disabled={!!f.standard}
                  />
                </div>
                <div className="sm:col-span-2 flex items-center justify-end gap-1">
                  {where === "rom" && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Move to Series"
                      onClick={() => moveFieldBetweenSeriesAndRom("rom", f.id)}
                    >
                      S
                    </Button>
                  )}
                  {where === "series" && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Move to NFT ROM"
                      onClick={() => moveFieldBetweenSeriesAndRom("series", f.id)}
                    >
                      N
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title={f.standard ? "Standard fields can be moved using Shared/Per-NFT" : "Remove field"}
                    onClick={() => !f.standard && removeField(where, f.id)}
                    disabled={!!f.standard}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Button type="button" size="sm" variant="outline" onClick={resetToDefault}>Reset</Button>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={placement === "series" ? "default" : "outline"}
            onClick={() => moveStandard("series")}
          >
            Shared
          </Button>
          <Button
            type="button"
            size="sm"
            variant={placement === "rom" ? "default" : "outline"}
            onClick={() => moveStandard("rom")}
          >
            Per-NFT
          </Button>
          <Button
            type="button"
            size="sm"
            variant={placement === "custom" ? "default" : "outline"}
            onClick={() => setPlacement("custom")}
            title="Custom placement — move fields individually"
          >
            Custom
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {renderSchemaSection("Series metadata (shared)", "series", seriesFields)}
        {renderSchemaSection("NFT metadata (ROM)", "rom", romFields)}
        {renderSchemaSection("NFT RAM", "ram", ramFields)}
      </div>

      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Schemas JSON (used for SDK parsing)</div>
        <textarea
          className="w-full rounded border p-2 font-mono text-xs"
          rows={8}
          readOnly
          value={schemasJson}
        />
      </div>
    </div>
  );
}
