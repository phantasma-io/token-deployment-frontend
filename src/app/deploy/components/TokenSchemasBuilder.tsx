"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Layers, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  initialPlacement?: Placement; // default: "rom" (Per-NFT)
  valueJson?: string; // initial value from parent
};

type SchemaJsonField = {
  name?: unknown;
  type?: unknown;
};

type InitialSchemaState = {
  seriesFields: Field[];
  romFields: Field[];
  ramFields: Field[];
};

const STANDARD_FIELDS_ORDERED: Field[] = standardMetadataFields.map(
  (field, index) => {
    const name = String(field.name);
    const type = name === "royalties" ? "Int32" : "String";
    return { id: `std-${index}`, name, type, standard: true };
  },
);

const STANDARD_FIELD_NAMES = new Set(
  STANDARD_FIELDS_ORDERED.map((field) => field.name),
);

function nextId(prefix: string, counter: number): string {
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

function parseSchemaFields(
  source: unknown,
  prefix: string,
  markStandard: boolean,
): Field[] {
  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((rawField, index) => {
    const field =
      rawField && typeof rawField === "object"
        ? (rawField as SchemaJsonField)
        : {};
    const name = String(field.name ?? "");
    const type = String(field.type ?? "String");

    return {
      id: nextId(prefix, index),
      name,
      type,
      standard: markStandard ? STANDARD_FIELD_NAMES.has(name) : false,
    };
  });
}

function buildInitialSchemaState(
  initialPlacement: Placement,
  valueJson?: string,
): InitialSchemaState {
  const candidate = valueJson?.trim();

  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const raw =
        parsed && typeof parsed === "object"
          ? (parsed as {
              seriesMetadata?: unknown;
              rom?: unknown;
              ram?: unknown;
            })
          : {};

      const series = parseSchemaFields(raw.seriesMetadata, "s", true);
      const rom = parseSchemaFields(raw.rom, "r", true);
      const ram = parseSchemaFields(raw.ram, "m", false);

      const stdInSeries = series.some((field) => field.standard);
      const stdInRom = rom.some((field) => field.standard);

      if (!stdInSeries && !stdInRom) {
        if (initialPlacement === "series") {
          return {
            seriesFields: [...STANDARD_FIELDS_ORDERED, ...series],
            romFields: rom,
            ramFields: ram,
          };
        }
        return {
          seriesFields: series,
          romFields: [...STANDARD_FIELDS_ORDERED, ...rom],
          ramFields: ram,
        };
      }

      return {
        seriesFields: series,
        romFields: rom,
        ramFields: ram,
      };
    } catch {
      // Fall through to default state.
    }
  }

  if (initialPlacement === "series") {
    return {
      seriesFields: [...STANDARD_FIELDS_ORDERED],
      romFields: [],
      ramFields: [],
    };
  }

  return {
    seriesFields: [],
    romFields: [...STANDARD_FIELDS_ORDERED],
    ramFields: [],
  };
}

function getDerivedPlacement(series: Field[], rom: Field[]): Placement {
  const hasStdSeries = series.some((field) => field.standard);
  const hasStdRom = rom.some((field) => field.standard);

  if (hasStdSeries && hasStdRom) return "custom";
  if (hasStdSeries) return "series";
  if (hasStdRom) return "rom";
  return "custom";
}

export function TokenSchemasBuilder({
  onChange,
  onStatusChange,
  initialPlacement = "rom",
  valueJson,
}: TokenSchemasBuilderProps) {
  const initialState = useMemo(
    () => buildInitialSchemaState(initialPlacement, valueJson),
    [initialPlacement, valueJson],
  );

  const [seriesFields, setSeriesFields] = useState<Field[]>(
    initialState.seriesFields,
  );
  const [romFields, setRomFields] = useState<Field[]>(initialState.romFields);
  const [ramFields, setRamFields] = useState<Field[]>(initialState.ramFields);
  const [ctr, setCtr] = useState(
    initialState.seriesFields.length +
      initialState.romFields.length +
      initialState.ramFields.length,
  );
  const [manualCustomMode, setManualCustomMode] = useState(false);

  const derivedPlacement = useMemo(
    () => getDerivedPlacement(seriesFields, romFields),
    [seriesFields, romFields],
  );
  const placement: Placement = manualCustomMode ? "custom" : derivedPlacement;

  const schemasJson = useMemo(() => {
    const payload = {
      seriesMetadata: seriesFields.map(({ name, type }) => ({ name, type })),
      rom: romFields.map(({ name, type }) => ({ name, type })),
      ram: ramFields.map(({ name, type }) => ({ name, type })),
    };
    return JSON.stringify(payload, null, 2);
  }, [seriesFields, romFields, ramFields]);

  useEffect(() => {
    onChange?.(schemasJson);
  }, [onChange, schemasJson]);

  const status = useMemo<BuilderStatus>(() => {
    const lower = (value: string) => value.trim().toLowerCase();
    const stdNames = new Set(
      Array.from(STANDARD_FIELD_NAMES).map((name) => name.toLowerCase()),
    );

    const findDuplicates = (fields: Field[]) => {
      const counts = new Map<string, number>();
      for (const field of fields) {
        const key = lower(field.name);
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([key]) => key);
    };

    const duplicateNames = Array.from(
      new Set([
        ...findDuplicates(seriesFields),
        ...findDuplicates(romFields),
        ...findDuplicates(ramFields),
      ]),
    );

    const seriesCustom = new Set(
      seriesFields
        .filter((field) => !field.standard && field.name.trim().length > 0)
        .map((field) => lower(field.name)),
    );
    const romCustom = new Set(
      romFields
        .filter((field) => !field.standard && field.name.trim().length > 0)
        .map((field) => lower(field.name)),
    );
    const crossNames: string[] = [];
    seriesCustom.forEach((name) => {
      if (romCustom.has(name)) crossNames.push(name);
    });

    const standardConflicts: string[] = [];
    const collectConflicts = (fields: Field[]) => {
      for (const field of fields) {
        if (field.standard) continue;
        const key = lower(field.name);
        if (key && stdNames.has(key)) {
          standardConflicts.push(key);
        }
      }
    };
    collectConflicts(seriesFields);
    collectConflicts(romFields);
    collectConflicts(ramFields);

    const uniqueDuplicateNames = Array.from(
      new Set([...duplicateNames, ...crossNames]),
    );
    const hasError =
      uniqueDuplicateNames.length > 0 || standardConflicts.length > 0;

    const isDefault =
      seriesFields.length === 0 &&
      ramFields.length === 0 &&
      romFields.length === STANDARD_FIELDS_ORDERED.length &&
      romFields.every(
        (field, index) =>
          field.standard &&
          field.name === STANDARD_FIELDS_ORDERED[index].name &&
          field.type === STANDARD_FIELDS_ORDERED[index].type,
      );

    return {
      hasError,
      duplicateNames: uniqueDuplicateNames,
      standardConflicts,
      isDefault,
    };
  }, [seriesFields, romFields, ramFields]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  const moveStandard = (target: Exclude<Placement, "custom">) => {
    setManualCustomMode(false);
    if (target === "series") {
      setRomFields((prev) => prev.filter((field) => !field.standard));
      setSeriesFields((prev) => {
        const nonStandard = prev.filter((field) => !field.standard);
        return [...STANDARD_FIELDS_ORDERED, ...nonStandard];
      });
      return;
    }

    setSeriesFields((prev) => prev.filter((field) => !field.standard));
    setRomFields((prev) => {
      const nonStandard = prev.filter((field) => !field.standard);
      return [...STANDARD_FIELDS_ORDERED, ...nonStandard];
    });
  };

  const moveFieldBetweenSeriesAndRom = (from: "series" | "rom", id: string) => {
    setManualCustomMode(true);

    if (from === "series") {
      const moved = seriesFields.find((field) => field.id === id);
      if (!moved) return;
      setSeriesFields((prev) => prev.filter((field) => field.id !== id));
      setRomFields((prev) => [...prev, moved]);
      return;
    }

    const moved = romFields.find((field) => field.id === id);
    if (!moved) return;
    setRomFields((prev) => prev.filter((field) => field.id !== id));
    setSeriesFields((prev) => [...prev, moved]);
  };

  const TypeSelect = ({
    value,
    onChange: handleChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!!disabled}
          className="w-full justify-between h-8"
        >
          <span className="truncate">{value}</span>
          <ChevronDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="max-h-60 overflow-y-auto p-1 min-w-[10rem]"
        align="start"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={handleChange}>
          {VM_TYPE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              className="cursor-pointer"
            >
              {option}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const addField = (where: "series" | "rom" | "ram") => {
    const field: Field = {
      id: nextId("x", ctr),
      name: "customField",
      type: "String",
      standard: false,
    };

    setCtr((prev) => prev + 1);
    if (where === "series") {
      setSeriesFields((prev) => [...prev, field]);
      return;
    }
    if (where === "rom") {
      setRomFields((prev) => [...prev, field]);
      return;
    }
    setRamFields((prev) => [...prev, field]);
  };

  const updateField = (
    where: "series" | "rom" | "ram",
    id: string,
    patch: Partial<Field>,
  ) => {
    const applyPatch = (fields: Field[]) =>
      fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      );

    if (where === "series") {
      setSeriesFields((prev) => applyPatch(prev));
      return;
    }
    if (where === "rom") {
      setRomFields((prev) => applyPatch(prev));
      return;
    }
    setRamFields((prev) => applyPatch(prev));
  };

  const removeField = (where: "series" | "rom" | "ram", id: string) => {
    const remove = (fields: Field[]) =>
      fields.filter((field) => field.id !== id);

    if (where === "series") {
      setSeriesFields((prev) => remove(prev));
      return;
    }
    if (where === "rom") {
      setRomFields((prev) => remove(prev));
      return;
    }
    setRamFields((prev) => remove(prev));
  };

  const resetToDefault = () => {
    setManualCustomMode(false);
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addField(where)}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Field
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {fields.length === 0 ? (
          <div className="text-xs text-muted-foreground">No fields</div>
        ) : (
          <div className="space-y-2">
            {fields.map((field) => (
              <div
                key={field.id}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
              >
                <input
                  className={(() => {
                    const base = "sm:col-span-5 rounded border px-2 py-1";
                    const key = field.name.trim().toLowerCase();
                    const stdNames = new Set(
                      Array.from(STANDARD_FIELD_NAMES).map((name) =>
                        name.toLowerCase(),
                      ),
                    );
                    const localList =
                      where === "series"
                        ? seriesFields
                        : where === "rom"
                          ? romFields
                          : ramFields;
                    const duplicate =
                      key &&
                      localList.some(
                        (item) =>
                          item.id !== field.id &&
                          item.name.trim().toLowerCase() === key,
                      );
                    const standardConflict =
                      !field.standard && key && stdNames.has(key);
                    const crossDuplicate =
                      !field.standard &&
                      key &&
                      (
                        where === "series"
                          ? romFields
                          : where === "rom"
                            ? seriesFields
                            : []
                      ).some(
                        (item) =>
                          !item.standard &&
                          item.name.trim().toLowerCase() === key,
                      );
                    return base +
                      (duplicate || standardConflict || crossDuplicate
                        ? " border-red-500 focus-visible:ring-red-500"
                        : "");
                  })()}
                  value={field.name}
                  onChange={(event) =>
                    updateField(where, field.id, { name: event.target.value })
                  }
                  placeholder="name"
                  disabled={!!field.standard}
                />
                <div className="sm:col-span-5">
                  <TypeSelect
                    value={field.type}
                    onChange={(value) =>
                      updateField(where, field.id, { type: value })
                    }
                    disabled={!!field.standard}
                  />
                </div>
                <div className="sm:col-span-2 flex items-center justify-end gap-1">
                  {where === "rom" && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Move to Series"
                      onClick={() =>
                        moveFieldBetweenSeriesAndRom("rom", field.id)
                      }
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
                      onClick={() =>
                        moveFieldBetweenSeriesAndRom("series", field.id)
                      }
                    >
                      N
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title={
                      field.standard
                        ? "Standard fields can be moved using Shared/Per-NFT"
                        : "Remove field"
                    }
                    onClick={() =>
                      !field.standard && removeField(where, field.id)
                    }
                    disabled={!!field.standard}
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={resetToDefault}
          >
            Reset
          </Button>
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
            onClick={() => setManualCustomMode(true)}
            title="Custom placement - move fields individually"
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
        <div className="text-xs font-medium text-muted-foreground">
          Schemas JSON (used for SDK parsing)
        </div>
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
