import { loadArchitecture } from "@sdl/architecture";
import type { Challenge } from "@sdl/challenges";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PageSpinner } from "@/components/PageSpinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/authContext";
import { EditorSession, FullHeight } from "@/features/playground/EditorSession";
import { getGuestDesign } from "@/features/playground/persistence/guestDesigns";
import { importGuestDesigns } from "@/features/playground/persistence/guestImport";
import type { Persistence } from "@/features/playground/persistence/saveStatus";
import { useGuestPersistence } from "@/features/playground/persistence/useGuestPersistence";
import { useServerPersistence } from "@/features/playground/persistence/useServerPersistence";
import { PlaygroundEditor } from "@/features/playground/PlaygroundEditor";
import type { EditorStore } from "@/features/playground/store/editorStore";
import { type Architecture, snapshotsApi, useArchitecture } from "@/lib/api/architectures";
import { type Attempt, attemptsApi, attemptsKey } from "@/lib/api/attempts";
import { ApiError, errorMessage } from "@/lib/api/client";
import { attemptPath } from "./attempts/attempts";
import { getGuestAttempt, importedAttemptId, isGuestAttemptId } from "./attempts/guestAttempts";
import { findChallenge } from "./content";
import { ChallengePanel } from "./workspace/ChallengePanel";
import { useAttemptState } from "./workspace/useAttemptState";

/** `/challenges/:slug/attempt/:attemptId`: the playground with the challenge panel (CH-3). */
export function ChallengeWorkspacePage() {
  const { slug, attemptId } = useParams();
  const { status } = useAuth();
  const location = useLocation();
  const challenge = findChallenge(slug);

  if (!challenge || !attemptId) {
    return <Problem title="Challenge not found">Pick a challenge from the library.</Problem>;
  }
  if (status === "loading") return <PageSpinner label="Loading challenge" />;
  if (isGuestAttemptId(attemptId)) {
    return status === "authenticated" ? (
      <MovingToAccount challenge={challenge} guestAttemptId={attemptId} />
    ) : (
      <GuestWorkspace key={attemptId} challenge={challenge} attemptId={attemptId} />
    );
  }
  if (status !== "authenticated") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <ServerWorkspace key={attemptId} challenge={challenge} attemptId={attemptId} />;
}

/** Signed in on a guest attempt's URL: it's being imported with its design, then opens from the account. */
function MovingToAccount({ challenge, guestAttemptId }: { challenge: Challenge; guestAttemptId: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    importGuestDesigns()
      .catch(() => null)
      .finally(() => {
        const id = importedAttemptId(guestAttemptId);
        navigate(id ? attemptPath(challenge.slug, id) : `/challenges/${challenge.slug}`, { replace: true });
      });
  }, [challenge.slug, guestAttemptId, navigate]);
  return <PageSpinner label="Moving your progress to your account" />;
}

function GuestWorkspace({ challenge, attemptId }: { challenge: Challenge; attemptId: string }) {
  const [attempt] = useState(() => getGuestAttempt(attemptId));
  const [design] = useState(() => (attempt?.architectureId ? getGuestDesign(attempt.architectureId) : null));
  if (!attempt) {
    const imported = importedAttemptId(attemptId);
    if (imported) return <Navigate to={attemptPath(challenge.slug, imported)} replace />;
    return (
      <Problem title="Attempt not found in this browser" slug={challenge.slug}>
        Guest progress is stored only in the browser it was made in. It may have been moved to an account.
      </Problem>
    );
  }
  if (!design) {
    return (
      <Problem title="This attempt's design was deleted" slug={challenge.slug}>
        Start over to get a fresh design.
      </Problem>
    );
  }
  const loaded = loadArchitecture(design.document);
  if (!loaded.ok) return <Problem title="This design can't be opened">{loaded.error}</Problem>;
  return (
    <EditorSession doc={loaded.document}>
      {(store) => (
        <GuestSession
          store={store}
          designId={design.id}
          title={design.title}
          challenge={challenge}
          attempt={attempt}
        />
      )}
    </EditorSession>
  );
}

function GuestSession(props: {
  store: EditorStore;
  designId: string;
  title: string;
  challenge: Challenge;
  attempt: Attempt;
}) {
  const persistence = useGuestPersistence({
    store: props.store,
    initial: { id: props.designId, title: props.title },
    onCreated: () => undefined,
  });
  const saveCheckpoint = useCallback(async () => false, []);
  return (
    <Workspace
      challenge={props.challenge}
      attempt={props.attempt}
      architectureId={null}
      persistence={persistence}
      saveCheckpoint={saveCheckpoint}
    />
  );
}

function ServerWorkspace({ challenge, attemptId }: { challenge: Challenge; attemptId: string }) {
  const { session } = useAuth();
  const attempt = useQuery({
    queryKey: [...attemptsKey(session?.user.id), "detail", attemptId],
    queryFn: () => attemptsApi.get(attemptId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const architecture = useArchitecture(attempt.data?.architectureId ?? undefined);

  if (attempt.isPending) return <PageSpinner label="Loading challenge" />;
  if (attempt.error) {
    return attempt.error instanceof ApiError && attempt.error.status === 404 ? (
      <Problem title="Attempt not found" slug={challenge.slug}>
        It may belong to another account.
      </Problem>
    ) : (
      <Problem title="Couldn't load the attempt">{errorMessage(attempt.error)}</Problem>
    );
  }
  if (attempt.data.challengeSlug !== challenge.slug) {
    return <Navigate to={attemptPath(attempt.data.challengeSlug, attemptId)} replace />;
  }
  if (!attempt.data.architectureId) {
    return (
      <Problem title="This attempt's design was deleted" slug={challenge.slug}>
        Start over to get a fresh design.
      </Problem>
    );
  }
  if (architecture.isPending) return <PageSpinner label="Loading design" />;
  if (architecture.error)
    return <Problem title="Couldn't load the design">{errorMessage(architecture.error)}</Problem>;
  return (
    <LoadedServerWorkspace challenge={challenge} attempt={attempt.data} architecture={architecture.data} />
  );
}

function LoadedServerWorkspace({
  challenge,
  attempt,
  architecture,
}: {
  challenge: Challenge;
  attempt: Attempt;
  architecture: Architecture;
}) {
  const [loaded] = useState(() => loadArchitecture(architecture.document));
  if (!loaded.ok) return <Problem title="This design can't be opened">{loaded.error}</Problem>;
  return (
    <EditorSession doc={loaded.document}>
      {(store) => (
        <ServerSession store={store} challenge={challenge} attempt={attempt} architecture={architecture} />
      )}
    </EditorSession>
  );
}

function ServerSession({
  store,
  challenge,
  attempt,
  architecture,
}: {
  store: EditorStore;
  challenge: Challenge;
  attempt: Attempt;
  architecture: Architecture;
}) {
  const persistence = useServerPersistence({ store, initial: architecture, onCreated: () => undefined });
  const saveCheckpoint = useCallback(
    async (label: string) => {
      try {
        await snapshotsApi.create(architecture.id, label, store.getState().doc);
        return true;
      } catch (e) {
        toast.error("Couldn't save a checkpoint", { description: errorMessage(e) });
        return false;
      }
    },
    [architecture.id, store],
  );
  return (
    <Workspace
      challenge={challenge}
      attempt={attempt}
      architectureId={architecture.id}
      persistence={persistence}
      saveCheckpoint={saveCheckpoint}
    />
  );
}

function Workspace({
  challenge,
  attempt: initial,
  architectureId,
  persistence,
  saveCheckpoint,
}: {
  challenge: Challenge;
  attempt: Attempt;
  /** The saved design on the server; null for a guest design kept in this browser. */
  architectureId: string | null;
  persistence: Persistence;
  saveCheckpoint(label: string): Promise<boolean>;
}) {
  const { attempt, update } = useAttemptState(initial);
  return (
    <FullHeight>
      <PlaygroundEditor
        persistence={persistence}
        mentor={{
          architectureId,
          // Guest attempts live in this browser; the mentor needs an account anyway.
          attemptId: isGuestAttemptId(attempt.id) ? null : attempt.id,
          interview: attempt.mode === "interview",
        }}
        challengePanel={
          <ChallengePanel
            challenge={challenge}
            attempt={attempt}
            update={update}
            saveCheckpoint={saveCheckpoint}
          />
        }
      />
    </FullHeight>
  );
}

function Problem({ title, slug, children }: { title: string; slug?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Alert>
        <CircleAlert />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {children}
          <div className="mt-3 flex gap-2">
            <Button size="sm" asChild>
              <Link to={slug ? `/challenges/${slug}` : "/challenges"}>
                {slug ? "Back to the challenge" : "Challenges"}
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
