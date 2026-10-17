import { checkDocumentForSave, loadArchitecture } from "@sdl/architecture";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/authContext";
import { type Architecture, architecturesApi, architecturesKey } from "@/lib/api/architectures";
import { ApiError, errorMessage } from "@/lib/api/client";
import type { EditorStore } from "../store/editorStore";
import { clearDraft, writeDraft } from "./drafts";
import type { Persistence, SaveStatus } from "./saveStatus";

export const AUTOSAVE_DELAY_MS = 2000;
const DRAFT_DELAY_MS = 300;
const NEW_DRAFT_ID = "new";

interface Options {
  store: EditorStore;
  /** The loaded design, or null for a new one that's created on first save. */
  initial: Pick<Architecture, "id" | "title" | "version"> | null;
  /** Called once a new design has been created, so the URL can include its id. */
  onCreated(id: string): void;
}

/**
 * Signed-in persistence (PG-9, PG-10): debounced autosave with If-Match, a local draft until the server
 * acknowledges the save, offline retry, and conflict resolution.
 */
export function useServerPersistence({ store, initial, onCreated }: Options): Persistence {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(initial?.title ?? "Untitled design");

  const id = useRef(initial?.id ?? null);
  const version = useRef(initial?.version ?? 0);
  const titleRef = useRef(title);
  const savedRevision = useRef(store.getState().revision);
  const inFlight = useRef(false);
  const blocked = useRef(false); // conflict: wait for the user's choice
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  });
  // Lets a save schedule the next one without the callback referring to itself.
  const saveRef = useRef<() => Promise<void>>(async () => undefined);

  const invalidateList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [...architecturesKey(session?.user.id), "list"] }),
    [queryClient, session?.user.id],
  );

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current || blocked.current) return;
    const { doc, revision } = store.getState();
    if (revision === savedRevision.current && id.current) {
      setStatus("saved");
      return;
    }
    const check = checkDocumentForSave(doc);
    if (!check.ok) {
      setStatus("error");
      setError(`Can't save: ${check.error}`);
      return;
    }

    inFlight.current = true;
    setStatus("saving");
    try {
      let saved: Architecture;
      if (id.current) {
        saved = await architecturesApi.save(id.current, doc, version.current);
      } else {
        saved = await architecturesApi.create({ title: titleRef.current, document: doc });
        id.current = saved.id;
        clearDraft(NEW_DRAFT_ID);
        onCreatedRef.current(saved.id);
      }
      version.current = saved.version;
      savedRevision.current = revision;
      setError(null);
      void invalidateList();
      if (store.getState().revision === revision) {
        clearDraft(saved.id);
        setStatus("saved");
      } else {
        setStatus("unsaved");
        timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        blocked.current = true;
        setStatus("conflict");
        setError(null);
      } else if (e instanceof ApiError && e.status === 0) {
        setStatus("offline");
        setError(null);
      } else {
        setStatus("error");
        setError(errorMessage(e));
      }
    } finally {
      inFlight.current = false;
    }
  }, [store, invalidateList]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Every document change: keep a local draft and schedule an autosave.
  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.revision === prev.revision) return;
        if (state.revision === savedRevision.current) return;
        clearTimeout(draftTimer.current);
        draftTimer.current = setTimeout(
          () => writeDraft(id.current ?? NEW_DRAFT_ID, store.getState().doc, version.current),
          DRAFT_DELAY_MS,
        );
        if (blocked.current) return;
        setStatus((s) => (s === "offline" ? s : "unsaved"));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
      }),
    [store, save],
  );

  // Retry when the connection comes back.
  useEffect(() => {
    const onOnline = () => {
      if (store.getState().revision !== savedRevision.current) void save();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [store, save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.getState().revision !== savedRevision.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(draftTimer.current);
    },
    [],
  );

  const rename = useCallback(
    (next: string) => {
      const trimmed = next.trim().slice(0, 100);
      if (!trimmed || trimmed === titleRef.current) return;
      titleRef.current = trimmed;
      setTitle(trimmed);
      if (id.current) {
        architecturesApi
          .rename(id.current, { title: trimmed })
          .then(() => void invalidateList())
          .catch((e: unknown) => setError(`Couldn't rename: ${errorMessage(e)}`));
      }
    },
    [invalidateList],
  );

  const resolveConflict = useCallback(
    async (choice: "reload" | "overwrite") => {
      if (!id.current) return;
      try {
        const latest = await architecturesApi.get(id.current);
        version.current = latest.version;
        if (choice === "reload") {
          const loaded = loadArchitecture(latest.document);
          if (!loaded.ok) throw new Error(loaded.error);
          store.getState().load(loaded.document);
          savedRevision.current = store.getState().revision;
          clearDraft(id.current);
          setTitle(latest.title);
          titleRef.current = latest.title;
          blocked.current = false;
          setStatus("saved");
        } else {
          blocked.current = false;
          savedRevision.current = -1; // force a save of the current document
          await save();
        }
      } catch (e) {
        setStatus("error");
        setError(errorMessage(e));
      }
    },
    [store, save],
  );

  return { status, target: "account", error, title, rename, saveNow: () => void save(), resolveConflict };
}
