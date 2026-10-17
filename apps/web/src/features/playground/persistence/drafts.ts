import type { ArchitectureDocument } from "@sdl/architecture";

// A signed-in user's unsaved changes are kept locally until the server acknowledges them
// (ARCHITECTURE §5.3), so a crash, closed tab or lost connection doesn't lose work.

const key = (designId: string) => `sdl-draft:v1:${designId}`;

export interface Draft {
  document: ArchitectureDocument;
  /** The server version the draft was based on. */
  baseVersion: number;
  savedAt: string;
}

export function readDraft(designId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key(designId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return typeof draft?.baseVersion === "number" && draft.document ? draft : null;
  } catch {
    return null;
  }
}

export function writeDraft(designId: string, document: ArchitectureDocument, baseVersion: number): void {
  try {
    const draft: Draft = { document, baseVersion, savedAt: new Date().toISOString() };
    window.localStorage.setItem(key(designId), JSON.stringify(draft));
  } catch {
    // Drafts are a safety net; saving to the server is the source of truth.
  }
}

export function clearDraft(designId: string): void {
  try {
    window.localStorage.removeItem(key(designId));
  } catch {
    // Ignore.
  }
}
