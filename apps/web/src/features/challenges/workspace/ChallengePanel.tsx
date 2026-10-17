import { type Challenge, type CriterionResult, type ExerciseAnswer, stageScenario } from "@sdl/challenges";
import { ENGINE_VERSION, FAILURES } from "@sdl/simulation";
import { Check, ChevronRight, CircleCheck, Circle, Lightbulb, Lock, Trophy, Zap } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { useSimulation } from "@/features/playground/simulation/simulationContext";
import { useEditorStore } from "@/features/playground/store/editorContext";
import type { Attempt, AttemptPatch } from "@/lib/api/attempts";
import { cn } from "@/lib/utils";
import { ExerciseCard } from "./Exercises";
import { StagePassedDialog } from "./StagePassedDialog";
import { useStageEvaluation } from "./useStageEvaluation";

interface PanelProps {
  challenge: Challenge;
  attempt: Attempt;
  update(change: (attempt: Attempt) => AttemptPatch): void;
  /** Saves a checkpoint of the design when a stage passes (signed-in only); resolves to whether it did. */
  saveCheckpoint(label: string): Promise<boolean>;
}

/** The challenge side of the workspace (CH-3 to CH-5): stage stepper, brief, exercises, live criteria, hints. */
export function ChallengePanel({ challenge, attempt, update, saveCheckpoint }: PanelProps) {
  const store = useEditorStore();
  const simulation = useSimulation();
  const stageIndex = Math.max(
    0,
    challenge.stages.findIndex((s) => s.id === attempt.currentStageId),
  );
  const stage = challenge.stages[stageIndex]!;
  const isLast = stageIndex === challenge.stages.length - 1;
  const passedAt = attempt.stageResults[stage.id]?.passedAt;
  const completed = attempt.status === "completed";
  const { results, passed } = useStageEvaluation(challenge, stageIndex, attempt.exerciseAnswers);
  const [checkpoint, setCheckpoint] = useState<{ stageId: string; saved: boolean } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Entering a stage, the sandbox simulation switches to the stage's traffic and failures, so what the panel
  // checks is what the simulation panel shows. The learner can change the sandbox; criteria don't follow it.
  useEffect(() => {
    const state = store.getState();
    const traffic = state.doc.traffic;
    if (traffic?.totalRps !== stage.traffic.totalRps || traffic?.mix) state.setTraffic(stage.traffic);
    state.setFailures(stageScenario(stage, state.doc).failures);
  }, [stage, store]);

  // The stage-pass moment: record the evidence once (ADR-010), finish the attempt on the last stage, and keep a
  // checkpoint of the design.
  useEffect(() => {
    if (!passed || passedAt || completed) return;
    const result = { passedAt: new Date().toISOString(), criteria: results, engineVersion: ENGINE_VERSION };
    update((a) => ({
      stageResults: { ...a.stageResults, [stage.id]: result },
      ...(isLast ? { status: "completed" as const } : {}),
    }));
    void saveCheckpoint(`Stage ${stageIndex + 1} passed: ${stage.title}`).then((saved) =>
      setCheckpoint({ stageId: stage.id, saved }),
    );
  }, [passed, passedAt, completed, results, stage, stageIndex, isLast, update, saveCheckpoint]);

  const advance = () => {
    const next = challenge.stages[stageIndex + 1];
    if (!next) return;
    update(() => ({ currentStageId: next.id }));
    // A stage that injects a failure is about seeing its effect: show the simulation straight away.
    if (next.scenario) simulation.setOpen(true);
  };

  const answer = (id: string, value: ExerciseAnswer) =>
    update((a) => ({ exerciseAnswers: { ...a.exerciseAnswers, [id]: value } }));

  const scenario = stage.scenario?.failures ?? [];
  // Only a pass made in this session opens the dialog; reopening a passed stage later doesn't replay it.
  const showDialog = checkpoint?.stageId === stage.id && dismissed !== stage.id;

  return (
    <div className="grid gap-0 divide-y">
      <div className="grid gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <Link to={`/challenges/${challenge.slug}`} className="text-sm font-semibold hover:underline">
            {challenge.title}
          </Link>
          <span className="text-xs text-muted-foreground">Guided mode</span>
        </div>
        <Stepper challenge={challenge} attempt={attempt} stageIndex={stageIndex} />
      </div>

      {completed && (
        <div className="flex items-start gap-2 bg-success/10 p-4 text-sm">
          <Trophy className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <div className="grid gap-1">
            <p className="font-medium">Challenge complete</p>
            <p className="text-xs text-muted-foreground">
              Keep experimenting: the design is yours. Your progress is on the{" "}
              <Link to="/" className="underline underline-offset-2">
                dashboard
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      <Section title={`Stage ${stageIndex + 1}: ${stage.title}`}>
        <Markdown className="text-sm leading-relaxed">{stage.briefMd}</Markdown>
        <p className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
          Checked at <strong>{stage.traffic.totalRps.toLocaleString("en")} requests/s</strong>
          {scenario.map((f) => (
            <span key={f.kind} className="inline-flex items-center gap-1 text-destructive">
              <Zap className="size-3" aria-hidden />
              {FAILURES[f.kind].label.toLowerCase()} ({f.target.pick === "most-writes" ? "the busiest " : ""}
              {f.target.type.replace(/-/g, " ")})
            </span>
          ))}
        </p>
        {passedAt && !isLast && (
          <Button size="sm" onClick={advance} className="w-fit">
            Continue to stage {stageIndex + 2} <ChevronRight className="size-4" />
          </Button>
        )}
      </Section>

      <Section title="Checklist">
        <Checklist challenge={challenge} stageIndex={stageIndex} results={results} />
      </Section>

      {(stage.exercises?.length ?? 0) > 0 && (
        <Section title="Exercises">
          <div className="grid gap-3">
            {stage.exercises!.map((e) => (
              <ExerciseCard
                key={e.id}
                exercise={e}
                answer={attempt.exerciseAnswers[e.id]}
                onAnswer={(value) => answer(e.id, value)}
              />
            ))}
          </div>
        </Section>
      )}

      {stage.hints.length > 0 && (
        <Section title="Hints">
          <Hints
            hints={stage.hints}
            revealed={attempt.hintsRevealed}
            onReveal={(id) => update((a) => ({ hintsRevealed: [...a.hintsRevealed, id] }))}
          />
        </Section>
      )}

      <Section title="Requirements">
        <Requirements challenge={challenge} />
      </Section>

      <StagePassedDialog
        open={showDialog}
        challenge={challenge}
        stageIndex={stageIndex}
        checkpoint={checkpoint?.saved ?? false}
        onContinue={() => {
          setDismissed(stage.id);
          advance();
        }}
        onClose={() => setDismissed(stage.id)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2.5 p-4">
      <h3 id={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stepper({
  challenge,
  attempt,
  stageIndex,
}: {
  challenge: Challenge;
  attempt: Attempt;
  stageIndex: number;
}) {
  return (
    <ol className="flex items-center gap-1" aria-label="Stages">
      {challenge.stages.map((s, i) => {
        const passed = !!attempt.stageResults[s.id]?.passedAt;
        const current = i === stageIndex;
        const state = passed ? "passed" : current ? "current" : "locked";
        return (
          <li
            key={s.id}
            className="flex flex-1 items-center gap-1"
            aria-current={current ? "step" : undefined}
          >
            <span
              className={cn(
                "flex h-7 flex-1 items-center justify-center gap-1 rounded-md border text-xs",
                state === "passed" && "border-success/50 bg-success/10 text-success",
                state === "current" && "border-primary bg-primary/10 font-medium text-primary",
                state === "locked" && "text-muted-foreground",
              )}
              title={s.title}
            >
              {state === "passed" ? (
                <Check className="size-3.5" aria-hidden />
              ) : state === "locked" ? (
                <Lock className="size-3" aria-hidden />
              ) : null}
              {i + 1}
              <span className="sr-only">
                : {s.title} (
                {state === "passed" ? "passed" : state === "current" ? "current stage" : "locked"})
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Checklist({
  challenge,
  stageIndex,
  results,
}: {
  challenge: Challenge;
  stageIndex: number;
  results: CriterionResult[];
}) {
  const criteria = challenge.stages[stageIndex]!.criteria;
  const done = results.filter((r) => r.passed).length;
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {done} of {results.length} done
      </p>
      <ul className="grid gap-1.5">
        {criteria.map((c) => {
          const r = results.find((x) => x.id === c.id);
          const ok = r?.passed ?? false;
          return (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {ok ? (
                <CircleCheck className="sdl-pop-in mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0">
                <span className="sr-only">{ok ? "Done: " : "To do: "}</span>
                <span className={cn(ok && "text-muted-foreground")}>{c.description}</span>
                {!ok && r && <span className="block text-xs text-muted-foreground">{r.detail}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Progressive hints (CH-5): one at a time, and the number used is kept with the attempt. */
function Hints({
  hints,
  revealed,
  onReveal,
}: {
  hints: Array<{ id: string; md: string }>;
  revealed: string[];
  onReveal(id: string): void;
}) {
  const shown = hints.filter((h) => revealed.includes(h.id));
  const next = hints.find((h) => !revealed.includes(h.id));
  return (
    <div className="grid gap-2">
      {shown.map((h, i) => (
        <div key={h.id} className="sdl-slide-up flex gap-2 rounded-md bg-muted/60 p-2.5 text-sm">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0">
            <span className="sr-only">Hint {i + 1}: </span>
            <Markdown>{h.md}</Markdown>
          </div>
        </div>
      ))}
      {next ? (
        <Button size="sm" variant="outline" className="h-8 w-fit" onClick={() => onReveal(next.id)}>
          <Lightbulb className="size-3.5" /> Show hint {shown.length + 1} of {hints.length}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">All {hints.length} hints shown.</p>
      )}
    </div>
  );
}

function Requirements({ challenge }: { challenge: Challenge }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Requirements and numbers</summary>
      <div className="mt-2 grid gap-3">
        <ul className="list-disc space-y-1 pl-5">
          {[...challenge.functionalRequirements, ...challenge.nonFunctionalRequirements].map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {challenge.constraints.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
