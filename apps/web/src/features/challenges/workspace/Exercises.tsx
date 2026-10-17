import {
  checkEstimate,
  type DecisionExercise,
  type EstimateExercise,
  type Exercise,
  type ExerciseAnswer,
  isExerciseCompleted,
} from "@sdl/challenges";
import { CircleCheck, CircleX, Lightbulb, Star } from "lucide-react";
import { useId, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ExerciseProps<E extends Exercise> {
  exercise: E;
  answer: ExerciseAnswer | undefined;
  onAnswer(answer: ExerciseAnswer): void;
}

export function ExerciseCard(props: ExerciseProps<Exercise>) {
  const done = isExerciseCompleted(props.exercise, props.answer);
  return (
    <section
      aria-label={props.exercise.prompt}
      className={cn("grid gap-2 rounded-md border p-3", done && "border-success/40 bg-success/5")}
    >
      <p className="text-sm font-medium">
        <span className="mr-1 text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {props.exercise.kind === "estimate" ? "Estimate" : "Decide"}
        </span>
        {props.exercise.prompt}
      </p>
      {props.exercise.kind === "estimate" ? (
        <Estimate {...(props as ExerciseProps<EstimateExercise>)} />
      ) : (
        <Decision {...(props as ExerciseProps<DecisionExercise>)} />
      )}
    </section>
  );
}

/** Tolerance-based check (J1 step 4); the worked solution is offered after an attempt. */
function Estimate({ exercise, answer, onAnswer }: ExerciseProps<EstimateExercise>) {
  const id = useId();
  const previous = answer?.kind === "estimate" ? answer : undefined;
  const [text, setText] = useState(previous ? String(previous.value) : "");
  const value = Number(text.replace(/,/g, ""));
  const valid = text.trim() !== "" && Number.isFinite(value) && value >= 0;
  const solved = previous?.correct ?? false;
  const showSolution = solved || previous?.revealed;

  const check = () => {
    if (!valid) return;
    onAnswer({
      kind: "estimate",
      value,
      correct: checkEstimate(exercise, value),
      attempts: (previous?.attempts ?? 0) + 1,
      revealed: previous?.revealed ?? false,
      answeredAt: new Date().toISOString(),
    });
  };

  return (
    <div className="grid gap-2">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
            Your estimate ({exercise.unit})
          </Label>
          <Input
            id={id}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={solved}
            className="h-8 w-32 font-mono"
          />
        </div>
        {!solved && (
          <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!valid}>
            Check
          </Button>
        )}
      </form>
      {previous && (
        <p
          role="status"
          className={cn("flex items-center gap-1.5 text-xs", solved ? "text-success" : "text-destructive")}
        >
          {solved ? (
            <CircleCheck className="size-3.5" aria-hidden />
          ) : (
            <CircleX className="size-3.5" aria-hidden />
          )}
          {solved
            ? `Close enough: within ${Math.round(exercise.tolerance * 100)}% of ${exercise.expected.toLocaleString("en")} ${exercise.unit}.`
            : `Not quite (${previous.attempts} attempt${previous.attempts === 1 ? "" : "s"}). Try again, or see how it's worked out.`}
        </p>
      )}
      {previous && !solved && !previous.revealed && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-fit px-2 text-xs"
          onClick={() => onAnswer({ ...previous, revealed: true, answeredAt: new Date().toISOString() })}
        >
          <Lightbulb className="size-3.5" /> Show the worked solution
        </Button>
      )}
      {showSolution && (
        <div className="rounded bg-muted/60 p-2 text-xs leading-relaxed">
          <Markdown>{exercise.workedSolution}</Markdown>
        </div>
      )}
    </div>
  );
}

/** Decision checkpoint: any choice completes it; the feedback explains the trade-offs (ADR-009). */
function Decision({ exercise, answer, onAnswer }: ExerciseProps<DecisionExercise>) {
  const name = useId();
  const chosen = answer?.kind === "decision" ? answer.optionId : undefined;
  const [selected, setSelected] = useState(chosen);
  const option = exercise.options.find((o) => o.id === chosen);

  return (
    <div className="grid gap-2">
      <fieldset className="grid gap-1.5">
        <legend className="sr-only">{exercise.prompt}</legend>
        {exercise.options.map((o) => (
          <label
            key={o.id}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-accent/50",
              selected === o.id && "border-primary",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.id}
              checked={selected === o.id}
              onChange={() => setSelected(o.id)}
              className="mt-0.5 accent-primary"
            />
            <span className="min-w-0 flex-1">{o.label}</span>
            {chosen && o.recommended && (
              <span className="flex shrink-0 items-center gap-0.5 text-xs text-success">
                <Star className="size-3" aria-hidden /> Recommended
              </span>
            )}
          </label>
        ))}
      </fieldset>
      <Button
        size="sm"
        variant="outline"
        className="h-8 w-fit"
        disabled={!selected || selected === chosen}
        onClick={() =>
          selected && onAnswer({ kind: "decision", optionId: selected, answeredAt: new Date().toISOString() })
        }
      >
        {chosen ? "Change answer" : "Submit"}
      </Button>
      {option && (
        <div role="status" className="rounded bg-muted/60 p-2 text-xs leading-relaxed">
          <Markdown>{option.feedback}</Markdown>
        </div>
      )}
    </div>
  );
}
