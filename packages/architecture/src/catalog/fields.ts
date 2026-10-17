import { z } from "zod";
import { OPERATION_ID_PATTERN } from "../ids";

/**
 * Inspector metadata for one config field. The same spec builds the Zod schema, so bounds and defaults
 * live in one place.
 */
export type FieldMeta =
  | {
      kind: "number";
      label: string;
      help: string;
      unit?: string;
      min: number;
      max: number;
      integer: boolean;
      /** Optional fields have no default; empty means "not set" (e.g. no rate limit). */
      optional: boolean;
    }
  | { kind: "ratio"; label: string; help: string; min: number; max: number }
  | {
      kind: "operations";
      label: string;
      help: string;
      /** What an unset list means, shown in the inspector. */
      whenUnset: string;
    };

export interface Field<S extends z.ZodType> {
  schema: S;
  meta: FieldMeta;
}

interface NumberSpec {
  label: string;
  help: string;
  unit?: string;
  min: number;
  max: number;
}

export function integer(spec: NumberSpec & { default: number }): Field<z.ZodDefault<z.ZodNumber>> {
  return {
    schema: z.number().int().min(spec.min).max(spec.max).default(spec.default),
    meta: { kind: "number", ...withoutDefault(spec), integer: true, optional: false },
  };
}

export function optionalInteger(spec: NumberSpec): Field<z.ZodOptional<z.ZodNumber>> {
  return {
    schema: z.number().int().min(spec.min).max(spec.max).optional(),
    meta: { kind: "number", ...spec, integer: true, optional: true },
  };
}

export function decimal(spec: NumberSpec & { default: number }): Field<z.ZodDefault<z.ZodNumber>> {
  return {
    schema: z.number().min(spec.min).max(spec.max).default(spec.default),
    meta: { kind: "number", ...withoutDefault(spec), integer: false, optional: false },
  };
}

/** A fraction in [0, 1], edited as a percentage. */
export function ratio(spec: {
  label: string;
  help: string;
  default: number;
}): Field<z.ZodDefault<z.ZodNumber>> {
  return {
    schema: z.number().min(0).max(1).default(spec.default),
    meta: { kind: "ratio", label: spec.label, help: spec.help, min: 0, max: 1 },
  };
}

export function operationList(spec: {
  label: string;
  help: string;
  whenUnset: string;
}): Field<z.ZodOptional<z.ZodArray<z.ZodString>>> {
  return {
    schema: z.array(z.string().regex(OPERATION_ID_PATTERN)).max(20).optional(),
    meta: { kind: "operations", ...spec },
  };
}

export type ConfigSchema = z.ZodObject<Record<string, z.ZodType>>;

export function configSchema(fields: Record<string, Field<z.ZodType>>): ConfigSchema {
  return z.object(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.schema])));
}

function withoutDefault<T extends { default: number }>(spec: T): Omit<T, "default"> {
  const { default: _default, ...rest } = spec;
  return rest;
}
