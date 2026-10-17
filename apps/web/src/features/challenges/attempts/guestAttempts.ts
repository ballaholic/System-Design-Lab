import type { Challenge } from "@sdl/challenges";
import type { Attempt, AttemptPatch } from "@/lib/api/attempts";

// Guest challenge progress lives in this browser (ARCHITECTURE §5.3) until it's imported after sign-in,
// together with the guest design it's linked to.

const KEY = "sdl-guest-attempts:v1";
const IMPORTED_KEY = "sdl-guest-attempts-imported:v1";
export const GUEST_ATTEMPT_PREFIX = "local-attempt-";

export const isGuestAttemptId = (id: string | undefined): id is string =>
  !!id && id.startsWith(GUEST_ATTEMPT_PREFIX);
/** The UUID part, used as the import idempotency key. */
export const attemptImportKey = (id: string) => id.slice(GUEST_ATTEMPT_PREFIX.length);

function read(): Attempt[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Attempt[]).filter((a) => typeof a?.id === "string") : [];
  } catch {
    return [];
  }
}

function write(attempts: Attempt[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(attempts));
    return true;
  } catch {
    return false;
  }
}

/** Newest activity first. */
export function listGuestAttempts(): Attempt[] {
  return read().sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export function getGuestAttempt(id: string): Attempt | null {
  return read().find((a) => a.id === id) ?? null;
}

/**
 * Starts an attempt linked to a guest design. Like the server's partial unique index, at most one attempt per
 * challenge is in progress: an existing one is abandoned (the caller asks the user first).
 */
export function createGuestAttempt(challenge: Challenge, architectureId: string, now = new Date()): Attempt {
  const at = now.toISOString();
  const attempt: Attempt = {
    id: `${GUEST_ATTEMPT_PREFIX}${crypto.randomUUID()}`,
    challengeSlug: challenge.slug,
    challengeVersion: challenge.version,
    mode: "guided",
    status: "in_progress",
    currentStageId: challenge.stages[0]!.id,
    architectureId,
    stageResults: {},
    exerciseAnswers: {},
    hintsRevealed: [],
    startedAt: at,
    lastActivityAt: at,
    completedAt: null,
  };
  const others = read().map((a) =>
    a.challengeSlug === challenge.slug && a.status === "in_progress"
      ? { ...a, status: "abandoned" as const, lastActivityAt: at }
      : a,
  );
  write([attempt, ...others]);
  return attempt;
}

export function updateGuestAttempt(id: string, patch: AttemptPatch, now = new Date()): Attempt | null {
  const attempts = read();
  const current = attempts.find((a) => a.id === id);
  if (!current) return null;
  const at = now.toISOString();
  const next: Attempt = {
    ...current,
    ...patch,
    lastActivityAt: at,
    ...(patch.status === "completed" ? { completedAt: at } : {}),
  };
  write(attempts.map((a) => (a.id === id ? next : a)));
  return next;
}

export function removeGuestAttempts(ids: readonly string[]): void {
  write(read().filter((a) => !ids.includes(a.id)));
}

/** After an import, a guest attempt URL redirects to the imported attempt. */
export function rememberImportedAttempts(mapping: Record<string, string>): void {
  try {
    const current = JSON.parse(window.sessionStorage.getItem(IMPORTED_KEY) ?? "{}") as Record<string, string>;
    window.sessionStorage.setItem(IMPORTED_KEY, JSON.stringify({ ...current, ...mapping }));
  } catch {
    // A convenience only.
  }
}

export function importedAttemptId(guestId: string): string | null {
  try {
    return (
      (JSON.parse(window.sessionStorage.getItem(IMPORTED_KEY) ?? "{}") as Record<string, string>)[guestId] ??
      null
    );
  } catch {
    return null;
  }
}
