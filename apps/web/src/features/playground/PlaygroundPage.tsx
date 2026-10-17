import { createEmptyDocument, loadArchitecture } from "@sdl/architecture";
import { CircleAlert, History } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PageSpinner } from "@/components/PageSpinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/authContext";
import { type Architecture, useArchitecture } from "@/lib/api/architectures";
import { ApiError, errorMessage } from "@/lib/api/client";
import { deepEqual } from "@/lib/deepEqual";
import { clearDraft, type Draft, readDraft } from "./persistence/drafts";
import { getGuestDesign, importedServerId, isGuestId } from "./persistence/guestDesigns";
import { importGuestDesigns } from "./persistence/guestImport";
import { useGuestPersistence } from "./persistence/useGuestPersistence";
import { useServerPersistence } from "./persistence/useServerPersistence";
import { PlaygroundEditor } from "./PlaygroundEditor";
import { EditorSession, FullHeight } from "./EditorSession";
import { useEditorStore } from "./store/editorContext";
import type { EditorStore } from "./store/editorStore";

type SessionState = { sessionKey?: string } | null;

/**
 * `/playground` opens a new design, `/playground/local-…` a guest design in this browser, and
 * `/playground/:id` a saved design. A new design keeps its editing session (and undo history) when its URL
 * changes after the first save.
 */
export function PlaygroundPage() {
  const { designId } = useParams();
  const location = useLocation();
  const sessionKey = (location.state as SessionState)?.sessionKey ?? designId ?? "new";
  return <PlaygroundLoader key={sessionKey} sessionKey={sessionKey} designId={designId} />;
}

function PlaygroundLoader({ sessionKey, designId }: { sessionKey: string; designId: string | undefined }) {
  const { status } = useAuth();
  const location = useLocation();
  // The route the session started on; later URL changes (after creating the design) don't reload it.
  const [initialId] = useState(designId);

  if (status === "loading") return <PageSpinner label="Loading design" />;
  if (!initialId) return <NewDesign sessionKey={sessionKey} signedIn={status === "authenticated"} />;
  if (isGuestId(initialId))
    return <GuestDesignLoader id={initialId} sessionKey={sessionKey} signedIn={status === "authenticated"} />;
  if (status !== "authenticated") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <ServerDesignLoader id={initialId} />;
}

function useOnCreated(sessionKey: string) {
  const navigate = useNavigate();
  return (id: string) =>
    navigate(`/playground/${id}`, { replace: true, state: { sessionKey } satisfies SessionState });
}

function NewDesign({ sessionKey, signedIn }: { sessionKey: string; signedIn: boolean }) {
  const onCreated = useOnCreated(sessionKey);
  const [draft] = useState(() => (signedIn ? readDraft("new") : null));
  return (
    <EditorSession doc={createEmptyDocument()}>
      {(store) =>
        signedIn ? (
          <ServerSession store={store} initial={null} onCreated={onCreated} draft={draft} draftId="new" />
        ) : (
          <GuestSession store={store} initial={null} onCreated={onCreated} />
        )
      }
    </EditorSession>
  );
}

function GuestDesignLoader({
  id,
  sessionKey,
  signedIn,
}: {
  id: string;
  sessionKey: string;
  signedIn: boolean;
}) {
  const onCreated = useOnCreated(sessionKey);
  const navigate = useNavigate();
  const [stored] = useState(() => getGuestDesign(id));

  // Signed in: this design is being moved to the account; open the imported copy.
  useEffect(() => {
    if (!signedIn) return;
    importGuestDesigns()
      .catch(() => null)
      .finally(() =>
        navigate(importedServerId(id) ? `/playground/${importedServerId(id)}` : "/designs", {
          replace: true,
        }),
      );
  }, [signedIn, id, navigate]);

  if (signedIn) return <PageSpinner label="Loading design" />;
  if (!stored) {
    const imported = importedServerId(id);
    if (imported) return <Navigate to={`/playground/${imported}`} replace />;
    return (
      <LoadProblem title="Design not found in this browser">
        Guest designs are stored only in the browser they were made in. It may have been deleted or moved to
        an account.
      </LoadProblem>
    );
  }
  const loaded = loadArchitecture(stored.document);
  if (!loaded.ok) return <LoadProblem title="This design can't be opened">{loaded.error}</LoadProblem>;
  return (
    <EditorSession doc={loaded.document}>
      {(store) => <GuestSession store={store} initial={{ id, title: stored.title }} onCreated={onCreated} />}
    </EditorSession>
  );
}

function ServerDesignLoader({ id }: { id: string }) {
  const { data, error, isPending } = useArchitecture(id);
  if (isPending) return <PageSpinner label="Loading design" />;
  if (error) {
    return error instanceof ApiError && error.status === 404 ? (
      <LoadProblem title="Design not found">
        It may have been deleted, or it belongs to another account.
      </LoadProblem>
    ) : (
      <LoadProblem title="Couldn't load the design">{errorMessage(error)}</LoadProblem>
    );
  }
  return <LoadedServerDesign architecture={data} />;
}

function LoadedServerDesign({ architecture }: { architecture: Architecture }) {
  const [loaded] = useState(() => loadArchitecture(architecture.document));
  const [draft] = useState(() => readDraft(architecture.id));
  useEffect(() => {
    if (loaded.ok && loaded.repairs.length > 0)
      toast.info("Some parts of this design were updated to the current format.", {
        description: loaded.repairs.join(" "),
      });
  }, [loaded]);
  if (!loaded.ok) return <LoadProblem title="This design can't be opened">{loaded.error}</LoadProblem>;
  return (
    <EditorSession doc={loaded.document}>
      {(store) => (
        <ServerSession
          store={store}
          initial={architecture}
          onCreated={() => undefined}
          draft={draft && !deepEqual(draft.document, loaded.document) ? draft : null}
          draftId={architecture.id}
          serverVersion={architecture.version}
        />
      )}
    </EditorSession>
  );
}

function ServerSession({
  store,
  initial,
  onCreated,
  draft,
  draftId,
  serverVersion,
}: {
  store: EditorStore;
  initial: Pick<Architecture, "id" | "title" | "version"> | null;
  onCreated(id: string): void;
  draft: Draft | null;
  draftId: string;
  serverVersion?: number;
}) {
  const persistence = useServerPersistence({ store, initial, onCreated });
  return (
    <FullHeight>
      {draft && (
        <DraftBanner
          draft={draft}
          draftId={draftId}
          stale={serverVersion !== undefined && draft.baseVersion < serverVersion}
        />
      )}
      <PlaygroundEditor persistence={persistence} />
    </FullHeight>
  );
}

function GuestSession(props: {
  store: EditorStore;
  initial: { id: string; title: string } | null;
  onCreated(id: string): void;
}) {
  const persistence = useGuestPersistence(props);
  return (
    <FullHeight>
      <PlaygroundEditor persistence={persistence} />
    </FullHeight>
  );
}

/** Offers changes that were never acknowledged by the server (closed tab, crash, offline). */
function DraftBanner({ draft, draftId, stale }: { draft: Draft; draftId: string; stale: boolean }) {
  const store = useEditorStore();
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const when = new Date(draft.savedAt).toLocaleString();
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="flex flex-wrap items-center gap-2 border-b bg-warning/10 px-3 py-2 text-sm"
    >
      <History className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        Unsaved changes from {when} were found on this device.
        {stale &&
          " The design has been saved elsewhere since; restoring will replace that version when saved."}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => {
          clearDraft(draftId);
          setOpen(false);
        }}
      >
        Discard
      </Button>
      <Button
        size="sm"
        className="h-7"
        onClick={() => {
          store.getState().commit(() => draft.document);
          setOpen(false);
        }}
      >
        Restore
      </Button>
    </div>
  );
}

function LoadProblem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Alert>
        <CircleAlert />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {children}
          <div className="mt-3 flex gap-2">
            <Button size="sm" asChild>
              <Link to="/playground">New design</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/designs">My designs</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
