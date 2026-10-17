import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorStore } from "../store/editorStore";
import { GUEST_DESIGN_LIMIT, newGuestId, renameGuestDesign, saveGuestDesign } from "./guestDesigns";
import type { Persistence, SaveStatus } from "./saveStatus";

export const GUEST_SAVE_DELAY_MS = 500;

interface Options {
  store: EditorStore;
  initial: { id: string; title: string } | null;
  onCreated(id: string): void;
}

/** Guest persistence: autosave to this browser (PG-9). A new design gets its id on the first edit. */
export function useGuestPersistence({ store, initial, onCreated }: Options): Persistence {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(initial?.title ?? "Untitled design");
  const id = useRef(initial?.id ?? null);
  const titleRef = useRef(title);
  const savedRevision = useRef(store.getState().revision);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  });

  const save = useCallback(() => {
    clearTimeout(timer.current);
    const { doc, revision } = store.getState();
    const isNew = id.current === null;
    const designId = id.current ?? newGuestId();
    const result = saveGuestDesign(designId, titleRef.current, doc);
    if (!result.ok) {
      setStatus("error");
      setError(
        result.reason === "limit"
          ? `This browser already holds ${GUEST_DESIGN_LIMIT} guest designs. Delete one, or sign in to save to your account.`
          : "This browser isn't letting the app store data (private mode or blocked storage). Sign in to save to your account.",
      );
      return;
    }
    id.current = designId;
    savedRevision.current = revision;
    setError(null);
    setStatus(store.getState().revision === revision ? "saved" : "unsaved");
    if (isNew) onCreatedRef.current(designId);
  }, [store]);

  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.revision === prev.revision || state.revision === savedRevision.current) return;
        setStatus("unsaved");
        clearTimeout(timer.current);
        timer.current = setTimeout(save, GUEST_SAVE_DELAY_MS);
      }),
    [store, save],
  );

  // Save pending edits when leaving the page; local saves are synchronous.
  useEffect(
    () => () => {
      if (timer.current !== undefined && store.getState().revision !== savedRevision.current) save();
      clearTimeout(timer.current);
    },
    [store, save],
  );

  const rename = useCallback(
    (next: string) => {
      const trimmed = next.trim().slice(0, 100);
      if (!trimmed || trimmed === titleRef.current) return;
      titleRef.current = trimmed;
      setTitle(trimmed);
      if (id.current) renameGuestDesign(id.current, trimmed);
      else save();
    },
    [save],
  );

  return { status, target: "browser", error, title, rename, saveNow: save };
}
