import { CURRENT_SCHEMA_VERSION } from "./schema";

/**
 * A pure structural migration from `from` to `from + 1` (ADR-022). Config fields don't need migrations:
 * unknown keys are dropped and missing ones filled from defaults on load.
 */
export interface Migration {
  from: number;
  description: string;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/** Version 1 is the first released schema, so nothing to migrate yet. */
export const MIGRATIONS: readonly Migration[] = [];

export type MigrationResult =
  { ok: true; document: Record<string, unknown>; from: number } | { ok: false; error: string };

export function migrateDocument(
  raw: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "The design isn't a valid architecture document." };
  }
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return { ok: false, error: "The design has no valid schema version." };
  }
  if (version > target) {
    return {
      ok: false,
      error: "This design was saved by a newer version of the app. Reload the page to update.",
    };
  }

  let document = raw as Record<string, unknown>;
  for (let v = version; v < target; v++) {
    const step = migrations.find((m) => m.from === v);
    if (!step) return { ok: false, error: `No migration from schema version ${v}.` };
    document = { ...step.migrate(document), schemaVersion: v + 1 };
  }
  return { ok: true, document, from: version };
}
