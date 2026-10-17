export type SaveStatus =
  /** Everything is saved (server, or this browser for guests). */
  | "saved"
  /** Edits not saved yet; an autosave is scheduled. */
  | "unsaved"
  | "saving"
  /** The server can't be reached; changes are kept as a local draft and retried. */
  | "offline"
  /** Another tab or device saved a newer version (PG-10). */
  | "conflict"
  | "error";

export interface Persistence {
  status: SaveStatus;
  /** Where saves go, for the status text. */
  target: "account" | "browser";
  error: string | null;
  title: string;
  rename(title: string): void;
  /** Saves now (Ctrl+S). */
  saveNow(): void;
  /** Conflict resolution: load the newer version, or overwrite it with this one. */
  resolveConflict?(choice: "reload" | "overwrite"): Promise<void>;
}
