import { checkDocumentForSave, loadArchitecture } from "@sdl/architecture";
import {
  attemptImportKey,
  listGuestAttempts,
  rememberImportedAttempts,
  removeGuestAttempts,
} from "@/features/challenges/attempts/guestAttempts";
import { architecturesApi, type ImportAttempt, type ImportDesign } from "@/lib/api/architectures";
import {
  deleteGuestDesign,
  getGuestDesign,
  importKeyOf,
  isGuestId,
  listGuestDesigns,
  rememberImported,
} from "./guestDesigns";

const BATCH = 10;

export interface GuestImportResult {
  imported: number;
  /** Local designs that couldn't be read or are invalid; they stay in this browser. */
  skipped: number;
  /** Challenge attempts moved with them. */
  attempts: number;
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
  // Abandoned attempts aren't worth keeping; the server takes up to 10 per request.
  const guestAttempts = listGuestAttempts()
    .filter((a) => a.status !== "abandoned")
    .slice(0, BATCH);
  if (summaries.length === 0 && guestAttempts.length === 0) return null;
  const attempts: ImportAttempt[] = guestAttempts.map((a) => ({
    importKey: attemptImportKey(a.id),
    challengeSlug: a.challengeSlug,
    challengeVersion: a.challengeVersion,
    mode: "guided", // guest attempts are always Guided: Interview mode needs an account
    status: a.status,
    currentStageId: a.currentStageId,
    ...(a.architectureId && isGuestId(a.architectureId)
      ? { architectureImportKey: importKeyOf(a.architectureId) }
      : {}),
    stageResults: a.stageResults,
    exerciseAnswers: a.exerciseAnswers,
    hintsRevealed: a.hintsRevealed,
    startedAt: a.startedAt,
    lastActivityAt: a.lastActivityAt,
    completedAt: a.completedAt,
  }));

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
      design: {
        importKey: importKeyOf(summary.id),
        title: summary.title,
        document: loaded.document,
        ...(summary.challengeSlug ? { challengeSlug: summary.challengeSlug } : {}),
      },
    });
  }

  let imported = 0;
  let importedAttempts = 0;
  const batches = Math.max(1, Math.ceil(ready.length / BATCH));
  for (let n = 0; n < batches; n++) {
    const batch = ready.slice(n * BATCH, (n + 1) * BATCH);
    // Attempts go with the last batch, so every design they link to has been imported by then.
    const last = n === batches - 1;
    if (batch.length === 0 && !(last && attempts.length > 0)) continue;
    const { results, attemptResults = [] } = await architecturesApi.import(
      batch.map((b) => b.design),
      last ? attempts : [],
    );
    if (last && attempts.length > 0) {
      const byKey = new Map(attemptResults.map((r) => [r.importKey, r.id]));
      const done = guestAttempts.filter((a) => byKey.has(attemptImportKey(a.id)));
      rememberImportedAttempts(
        Object.fromEntries(done.map((a) => [a.id, byKey.get(attemptImportKey(a.id))!])),
      );
      removeGuestAttempts(done.map((a) => a.id));
      importedAttempts = done.length;
    }
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
  return { imported, skipped, attempts: importedAttempts };
}
