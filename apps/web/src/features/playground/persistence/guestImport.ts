import { checkDocumentForSave, loadArchitecture } from "@sdl/architecture";
import { architecturesApi, type ImportDesign } from "@/lib/api/architectures";
import {
  deleteGuestDesign,
  getGuestDesign,
  importKeyOf,
  listGuestDesigns,
  rememberImported,
} from "./guestDesigns";

const BATCH = 10;

export interface GuestImportResult {
  imported: number;
  /** Local designs that couldn't be read or are invalid; they stay in this browser. */
  skipped: number;
}

let running: Promise<GuestImportResult | null> | null = null;

/**
 * Imports this browser's guest designs into the signed-in account (AUTH-9). Safe to call repeatedly or from
 * several tabs: each design's UUID is its idempotency key, so the server never creates it twice. Imported
 * designs are removed from the browser only after the server confirms them.
 */
export function importGuestDesigns(): Promise<GuestImportResult | null> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<GuestImportResult | null> {
  const summaries = listGuestDesigns();
  if (summaries.length === 0) return null;

  const ready: Array<{ guestId: string; design: ImportDesign }> = [];
  let skipped = 0;
  for (const summary of summaries) {
    const stored = getGuestDesign(summary.id);
    const loaded = stored ? loadArchitecture(stored.document) : null;
    if (!loaded?.ok || !checkDocumentForSave(loaded.document).ok) {
      skipped++;
      continue;
    }
    ready.push({
      guestId: summary.id,
      design: { importKey: importKeyOf(summary.id), title: summary.title, document: loaded.document },
    });
  }

  let imported = 0;
  for (let i = 0; i < ready.length; i += BATCH) {
    const batch = ready.slice(i, i + BATCH);
    const { results } = await architecturesApi.import(batch.map((b) => b.design));
    const byKey = new Map(results.map((r) => [r.importKey, r.id]));
    const mapping: Record<string, string> = {};
    for (const { guestId, design } of batch) {
      const serverId = byKey.get(design.importKey);
      if (!serverId) continue;
      mapping[guestId] = serverId;
      deleteGuestDesign(guestId);
      imported++;
    }
    rememberImported(mapping);
  }
  return { imported, skipped };
}
