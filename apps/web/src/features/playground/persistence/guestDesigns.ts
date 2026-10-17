import type { ArchitectureDocument } from "@sdl/architecture";

// Guest designs live in this browser only (PRD guest mode, ARCHITECTURE §5.3) until imported after sign-in.
// An index key lists designs; each document has its own key so saving one doesn't rewrite the others.

export const GUEST_DESIGN_LIMIT = 10;
const INDEX_KEY = "sdl-guest-designs:v1";
const designKey = (id: string) => `sdl-guest-design:v1:${id}`;
/** Guest design ids are UUIDs prefixed so they can't be confused with server ids in URLs. */
export const GUEST_PREFIX = "local-";

export interface GuestDesignSummary {
  id: string;
  title: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GuestDesign extends GuestDesignSummary {
  document: unknown;
}

export type GuestSaveResult = { ok: true } | { ok: false; reason: "limit" | "storage" };

export const isGuestId = (id: string | undefined): id is string => !!id && id.startsWith(GUEST_PREFIX);
export const newGuestId = () => `${GUEST_PREFIX}${crypto.randomUUID()}`;
/** The UUID part, used as the idempotency key when importing (AUTH-9). */
export const importKeyOf = (guestId: string) => guestId.slice(GUEST_PREFIX.length);

function readIndex(): GuestDesignSummary[] {
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as GuestDesignSummary[]).filter((d) => typeof d?.id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeIndex(index: GuestDesignSummary[]): boolean {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

export function listGuestDesigns(): GuestDesignSummary[] {
  return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getGuestDesign(id: string): GuestDesign | null {
  const summary = readIndex().find((d) => d.id === id);
  if (!summary) return null;
  try {
    const raw = window.localStorage.getItem(designKey(id));
    return raw ? { ...summary, document: JSON.parse(raw) as unknown } : null;
  } catch {
    return null;
  }
}

export function saveGuestDesign(id: string, title: string, document: ArchitectureDocument): GuestSaveResult {
  const index = readIndex();
  const existing = index.find((d) => d.id === id);
  if (!existing && index.length >= GUEST_DESIGN_LIMIT) return { ok: false, reason: "limit" };
  const now = new Date().toISOString();
  const summary: GuestDesignSummary = {
    id,
    title,
    nodeCount: document.nodes.length,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  try {
    window.localStorage.setItem(designKey(id), JSON.stringify(document));
  } catch {
    return { ok: false, reason: "storage" };
  }
  const ok = writeIndex([summary, ...index.filter((d) => d.id !== id)]);
  return ok ? { ok: true } : { ok: false, reason: "storage" };
}

export function renameGuestDesign(id: string, title: string): void {
  writeIndex(
    readIndex().map((d) => (d.id === id ? { ...d, title, updatedAt: new Date().toISOString() } : d)),
  );
}

export function deleteGuestDesign(id: string): void {
  writeIndex(readIndex().filter((d) => d.id !== id));
  try {
    window.localStorage.removeItem(designKey(id));
  } catch {
    // Nothing else to do; the index no longer lists it.
  }
}

/** Copies a guest design under a new id. */
export function duplicateGuestDesign(id: string): string | null {
  const design = getGuestDesign(id);
  if (!design) return null;
  const copyId = newGuestId();
  const result = saveGuestDesign(
    copyId,
    `Copy of ${design.title}`.slice(0, 100),
    design.document as ArchitectureDocument,
  );
  return result.ok ? copyId : null;
}

// After an import, a guest URL redirects to the imported server design.
const IMPORTED_KEY = "sdl-guest-imported:v1";

export function rememberImported(mapping: Record<string, string>): void {
  try {
    const current = JSON.parse(window.sessionStorage.getItem(IMPORTED_KEY) ?? "{}") as Record<string, string>;
    window.sessionStorage.setItem(IMPORTED_KEY, JSON.stringify({ ...current, ...mapping }));
  } catch {
    // Redirects after import are a convenience.
  }
}

export function importedServerId(guestId: string): string | null {
  try {
    const mapping = JSON.parse(window.sessionStorage.getItem(IMPORTED_KEY) ?? "{}") as Record<string, string>;
    return mapping[guestId] ?? null;
  } catch {
    return null;
  }
}
