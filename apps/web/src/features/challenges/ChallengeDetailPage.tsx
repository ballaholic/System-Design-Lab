import { ArrowLeft, CircleAlert, Lock, MessagesSquare, Play, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Attempt } from "@/lib/api/attempts";
import { errorMessage } from "@/lib/api/client";
import { useMentorQuota } from "@/lib/api/mentor";
import { useAuth } from "@/features/auth/authContext";
import { attemptPath, currentAttempt, stageNumber, useAttempts, useStartAttempt } from "./attempts/attempts";
import { ChallengeStatus } from "./ChallengeStatus";
import { DIFFICULTY_LABEL, findChallenge, topicLabel } from "./content";

export function ChallengeDetailPage() {
  const { slug } = useParams();
  const challenge = findChallenge(slug);
  const navigate = useNavigate();
  const { attempts, isPending } = useAttempts();
  const start = useStartAttempt();
  const [busy, setBusy] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState<{ attempt: Attempt; mode: Attempt["mode"] } | null>(
    null,
  );
  const { status } = useAuth();
  const mentor = useMentorQuota();

  if (!challenge) {
    return (
      <Alert className="mx-auto max-w-xl">
        <CircleAlert />
        <AlertTitle>Challenge not found</AlertTitle>
        <AlertDescription>
          <Link to="/challenges" className="underline underline-offset-2">
            Browse the challenges
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const attempt = currentAttempt(attempts, challenge.slug);
  const inProgress = attempt?.status === "in_progress" ? attempt : undefined;

  // Interview mode is the AI interviewer, so it needs a verified account and the mentor switched on (PRD CH-8).
  const interviewBlocked =
    status !== "authenticated"
      ? "Interview mode needs an account with a verified email."
      : !mentor.data
        ? "Checking whether the AI mentor is available…"
        : !mentor.data.emailVerified
          ? "Verify your email to use Interview mode."
          : !mentor.data.available
            ? "The AI mentor is turned off right now, so Interview mode is unavailable."
            : null;

  const begin = async (restart: boolean, mode: Attempt["mode"] = "guided") => {
    setBusy(true);
    try {
      const result = await start(challenge, restart, mode);
      if (result.ok) navigate(attemptPath(challenge.slug, result.attempt.id));
      else if (result.inProgress) setConfirmRestart({ attempt: result.inProgress, mode });
      else toast.error("An attempt is already in progress. Reload the page and try again.");
    } catch (e) {
      toast.error("Couldn't start the challenge", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="mx-auto grid max-w-3xl gap-8 pb-12">
      <div className="grid gap-3">
        <Link
          to="/challenges"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> All challenges
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{DIFFICULTY_LABEL[challenge.difficulty]}</Badge>
          {challenge.topics.map((t) => (
            <Badge key={t} variant="outline" className="font-normal">
              {topicLabel(t)}
            </Badge>
          ))}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{challenge.title}</h1>
        <p className="text-muted-foreground">{challenge.summary}</p>
        {!isPending && <ChallengeStatus challenge={challenge} attempt={attempt} />}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {inProgress ? (
            <>
              <Button asChild>
                <Link to={attemptPath(challenge.slug, inProgress.id)}>
                  <Play className="size-4" /> Continue stage {stageNumber(challenge, inProgress)}
                </Link>
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmRestart({ attempt: inProgress, mode: "guided" })}
              >
                <RotateCcw className="size-4" /> Start over
              </Button>
            </>
          ) : (
            <Button disabled={busy || isPending} onClick={() => void begin(false)}>
              <Play className="size-4" />{" "}
              {attempt?.status === "completed" ? "Play again" : "Start in Guided mode"}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || isPending || interviewBlocked !== null}
            aria-describedby="interview-note"
            onClick={() =>
              inProgress
                ? setConfirmRestart({ attempt: inProgress, mode: "interview" })
                : void begin(false, "interview")
            }
          >
            {interviewBlocked ? <Lock className="size-4" /> : <MessagesSquare className="size-4" />} Interview
            mode
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Guided mode shows hints when you ask for them and checks each stage as you build.{" "}
          <span id="interview-note">
            {interviewBlocked ??
              "In Interview mode an AI interviewer leads, and hints and worked solutions stay hidden."}
          </span>
        </p>
      </div>

      <Section title="What you'll learn">
        <List items={challenge.objectives} />
      </Section>
      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Requirements">
          <List items={challenge.functionalRequirements} />
          {challenge.nonFunctionalRequirements.length > 0 && (
            <List items={challenge.nonFunctionalRequirements} />
          )}
        </Section>
        <Section title="Numbers to work with">
          <List items={challenge.constraints} />
        </Section>
      </div>
      <Section title="Stages">
        <ol className="grid gap-2">
          {challenge.stages.map((s, i) => (
            <li key={s.id} className="flex items-baseline gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
              <span className="font-medium">{s.title}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {s.traffic.totalRps.toLocaleString("en")} requests/s{s.scenario ? " · with a failure" : ""}
              </span>
            </li>
          ))}
        </ol>
      </Section>
      {challenge.reference && (
        <p className="border-t pt-4 text-xs text-muted-foreground">
          Inspired by <cite>{challenge.reference.source}</cite>
          {challenge.reference.chapter ? `, chapter ${challenge.reference.chapter}` : ""}. The challenge, its
          stages and all text are original; there's no affiliation with the book or its author.
        </p>
      )}

      <AlertDialog open={confirmRestart !== null} onOpenChange={(open) => !open && setConfirmRestart(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start over?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re on stage {confirmRestart ? stageNumber(challenge, confirmRestart.attempt) : 1} of
              this challenge.{" "}
              {confirmRestart?.mode === "interview" ? "Starting an interview" : "Starting over"} abandons that
              attempt and begins a new one with a fresh design. The old design stays in My designs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my attempt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const mode = confirmRestart?.mode ?? "guided";
                setConfirmRestart(null);
                void begin(true, mode);
              }}
            >
              {confirmRestart?.mode === "interview" ? "Start the interview" : "Start over"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
