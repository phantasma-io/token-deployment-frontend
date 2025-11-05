// Shared Carbon schema helpers: VM types and mandatory fields

export const VM_TYPE_OPTIONS = [
  "Dynamic",
  "Array",
  "Bytes",
  "Struct",
  "Int8",
  "Int16",
  "Int32",
  "Int64",
  "Int256",
  "Bytes16",
  "Bytes32",
  "Bytes64",
  "String",
  "Array_Dynamic",
  "Array_Bytes",
  "Array_Struct",
  "Array_Int8",
  "Array_Int16",
  "Array_Int32",
  "Array_Int64",
  "Array_Int256",
  "Array_Bytes16",
  "Array_Bytes32",
  "Array_Bytes64",
  "Array_String",
] as const;

export type VmTypeName = typeof VM_TYPE_OPTIONS[number];

// This module exports only UI-friendly list of VmType names
// for building dropdowns. Validation/parsing is delegated to SDK builders.
