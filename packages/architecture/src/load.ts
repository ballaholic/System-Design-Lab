import type { z } from "zod";
import { CATALOG, type ComponentConfig, type ComponentType, isComponentType } from "./catalog";
import { documentByteSize, LIMITS } from "./limits";
import { type Migration, MIGRATIONS, migrateDocument } from "./migrations";
import { type ArchitectureDocument, ArchitectureDocumentSchema } from "./schema";

export type LoadResult =
  | {
      ok: true;
      document: ArchitectureDocument;
      /** Human-readable notes about anything that was repaired or dropped. */
      repairs: string[];
    }
  | { ok: false; error: string };

/**
 * Loads a stored document: migrates it to the current version, repairs what can be repaired without guessing
 * (config fields reset to defaults, unknown components and orphaned layout dropped), then validates the schema.
 */
export function loadArchitecture(raw: unknown, migrations: readonly Migration[] = MIGRATIONS): LoadResult {
  const migrated = migrateDocument(raw, migrations);
  if (!migrated.ok) return migrated;

  const repairs: string[] = [];
  const doc = { ...migrated.document };

  if (Array.isArray(doc.nodes)) {
    const kept: unknown[] = [];
    for (const node of doc.nodes as Array<Record<string, unknown>>) {
      const type = typeof node?.type === "string" ? node.type : "";
      if (!isComponentType(type)) {
        repairs.push(`Removed a component of unknown type "${type}".`);
        continue;
      }
      const { config, changed } = normalizeConfig(type, node.config);
      if (changed) repairs.push(`Reset invalid settings on "${String(node.label ?? type)}" to defaults.`);
      kept.push({ ...node, config });
    }
    doc.nodes = kept;
    const ids = new Set(kept.map((n) => (n as { id?: unknown }).id));
    if (Array.isArray(doc.edges)) {
      const edges = (doc.edges as Array<Record<string, unknown>>).filter(
        (e) => ids.has(e?.source) && ids.has(e?.target),
      );
      if (edges.length !== doc.edges.length)
        repairs.push("Removed connections to components that no longer exist.");
      doc.edges = edges;
    }
    if (doc.layout && typeof doc.layout === "object") {
      doc.layout = Object.fromEntries(Object.entries(doc.layout).filter(([id]) => ids.has(id)));
    }
  }

  const parsed = ArchitectureDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    return { ok: false, error: `The design couldn't be read: ${describeIssue(parsed.error)}` };
  }
  return { ok: true, document: parsed.data as ArchitectureDocument, repairs };
}

/** Strict schema check for a document about to be saved, including the size limit. */
export function checkDocumentForSave(doc: unknown): { ok: true } | { ok: false; error: string } {
  const parsed = ArchitectureDocumentSchema.safeParse(doc);
  if (!parsed.success) return { ok: false, error: describeIssue(parsed.error) };
  if (documentByteSize(doc) > LIMITS.documentBytes) {
    return { ok: false, error: `The design is larger than ${LIMITS.documentBytes / 1024} KB.` };
  }
  return { ok: true };
}

/**
 * Keeps only known fields. A field whose value is missing or out of bounds gets its default (or is left unset
 * when it's optional), so catalog changes never need document migrations.
 */
export function normalizeConfig<T extends ComponentType>(
  type: T,
  config: unknown,
): { config: ComponentConfig<T>; changed: boolean } {
  const source =
    config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const shape = CATALOG[type].configSchema.shape as Record<string, z.ZodType>;
  const result: Record<string, unknown> = {};
  let changed = source !== config;
  for (const [key, schema] of Object.entries(shape)) {
    const parsed = schema.safeParse(source[key]);
    const value = parsed.success ? parsed.data : schema.safeParse(undefined).data;
    if (!parsed.success && source[key] !== undefined) changed = true;
    if (value !== undefined) result[key] = value;
  }
  if (Object.keys(source).some((key) => !Object.hasOwn(shape, key))) changed = true;
  return { config: result as ComponentConfig<T>, changed };
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid document.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
