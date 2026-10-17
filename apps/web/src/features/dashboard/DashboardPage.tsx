import type { Challenge } from "@sdl/challenges";
import { ArrowRight, CircleAlert, LayoutTemplate, Play, Sparkles, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  attemptPath,
  currentAttempt,
  stageNumber,
  useAttempts,
} from "@/features/challenges/attempts/attempts";
import { ChallengeStatus } from "@/features/challenges/ChallengeStatus";
import { CHALLENGES } from "@/features/challenges/content";
import { type ArchitectureSummary, useArchitectureList } from "@/lib/api/architectures";
import type { Attempt } from "@/lib/api/attempts";
import { errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/api/me";

const passedStages = (attempt: Attempt) =>
  Object.values(attempt.stageResults).filter((r) => r.passedAt).length;

/** The next challenge in curriculum order that isn't finished or under way (DASH-3). */
function recommended(attempts: readonly Attempt[]): Challenge | undefined {
  return CHALLENGES.find((c) => !currentAttempt(attempts, c.slug));
}

/**
 * Dashboard v1 (DASH-1 to DASH-5): continue learning, challenge progress, a recommended next challenge and recent
 * designs. Every number comes from saved attempts and designs; a new user sees one clear call to action.
 */
export function DashboardPage() {
  const me = useMe();
  const { attempts, isPending: attemptsPending, error: attemptsError } = useAttempts();
  const designs = useArchitectureList();
  const loading = attemptsPending || designs.isPending;
  const continueWith = attempts.find((a) => a.status === "in_progress");
  const continueChallenge = continueWith && CHALLENGES.find((c) => c.slug === continueWith.challengeSlug);
  const next = recommended(attempts);
  const isNew = !loading && attempts.length === 0 && (designs.data?.length ?? 0) === 0;
  const first = CHALLENGES[0];

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        {me.isPending ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">
            {me.data ? `Welcome, ${me.data.displayName}` : "Welcome"}
          </h1>
        )}
        <p className="text-sm text-muted-foreground">Your learning overview.</p>
      </header>

      {Boolean(me.error || attemptsError) && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn&apos;t load everything</AlertTitle>
          <AlertDescription>{errorMessage(me.error ?? attemptsError)}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : isNew && first ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing here yet"
          description={`Start with the ${first.title}: estimate, build and scale a real system in ${first.stages.length} stages. Your progress and designs will show up here.`}
          action={
            <Button asChild>
              <Link to={`/challenges/${first.slug}`}>
                Start the {first.title} challenge <ArrowRight className="size-4" />
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {continueWith && continueChallenge && (
            <ContinueCard challenge={continueChallenge} attempt={continueWith} />
          )}
          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="Challenge progress">
              <ul className="divide-y rounded-lg border">
                {CHALLENGES.map((c) => {
                  const attempt = currentAttempt(attempts, c.slug);
                  return (
                    <li key={c.slug}>
                      <Link
                        to={`/challenges/${c.slug}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-accent"
                      >
                        <span className="grid gap-0.5">
                          <span className="font-medium">{c.title}</span>
                          <ChallengeStatus challenge={c} attempt={attempt} />
                        </span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {attempt ? passedStages(attempt) : 0}/{c.stages.length} stages
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {next ? (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Recommended next:</span>
                  <Link
                    to={`/challenges/${next.slug}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {next.title}
                  </Link>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You&apos;ve started every challenge available. More are on the way.
                </p>
              )}
            </Panel>
            <Panel title="Recent designs">
              <RecentDesigns data={designs.data} error={designs.error} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/** Continue learning (DASH-1): the most recently active attempt in progress. */
function ContinueCard({ challenge, attempt }: { challenge: Challenge; attempt: Attempt }) {
  const n = stageNumber(challenge, attempt);
  const stage = challenge.stages[n - 1];
  const done = passedStages(attempt);
  return (
    <section
      aria-labelledby="continue-heading"
      className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-5"
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Trophy className="size-5" aria-hidden />
      </div>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Continue learning</p>
        <h2 id="continue-heading" className="font-semibold">
          Continue: {challenge.title} — Stage {n}
        </h2>
        <p className="text-sm text-muted-foreground">{stage?.title}</p>
        <div
          className="h-1.5 max-w-sm overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Stages passed"
          aria-valuemin={0}
          aria-valuemax={challenge.stages.length}
          aria-valuenow={done}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${(done / challenge.stages.length) * 100}%` }}
          />
        </div>
      </div>
      <Button asChild>
        <Link to={attemptPath(challenge.slug, attempt.id)}>
          <Play className="size-4" /> Resume
        </Link>
      </Button>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = `panel-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="grid content-start gap-3">
      <h2 id={id} className="text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RecentDesigns({ data, error }: { data: ArchitectureSummary[] | undefined; error: unknown }) {
  if (error)
    return (
      <p className="text-sm text-muted-foreground">Couldn&apos;t load your designs: {errorMessage(error)}</p>
    );
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No saved designs"
        description="Designs you build in the playground are saved here automatically."
        action={
          <Button size="sm" asChild>
            <Link to="/playground">Open the playground</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-2">
      <ul className="divide-y rounded-lg border">
        {data.slice(0, 5).map((d) => (
          <li key={d.id}>
            <Link
              to={`/playground/${d.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-accent"
            >
              <span className="truncate font-medium">{d.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {d.nodeCount} component{d.nodeCount === 1 ? "" : "s"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/designs" className="w-fit text-sm text-muted-foreground underline-offset-2 hover:underline">
        All designs
      </Link>
    </div>
  );
}
