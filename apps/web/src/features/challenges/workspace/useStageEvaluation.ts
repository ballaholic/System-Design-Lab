import {
  type Challenge,
  type CriterionResult,
  evaluateStage,
  type ExerciseAnswers,
  exercisesUpTo,
  isStagePassed,
  simulateStage,
} from "@sdl/challenges";
import { useMemo } from "react";
import { useEditor } from "@/features/playground/store/editorContext";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

/** Waits for edits to settle before re-checking, like Live simulation. */
const DEBOUNCE_MS = 250;

/**
 * Live criteria for the current stage (CH-3): the stage's own traffic and failures, evaluated in the browser
 * (ADR-010). Answers apply immediately; design edits after a short pause.
 */
export function useStageEvaluation(
  challenge: Challenge,
  stageIndex: number,
  answers: ExerciseAnswers,
): { results: CriterionResult[]; passed: boolean } {
  const doc = useDebouncedValue(
    useEditor((s) => s.doc),
    DEBOUNCE_MS,
  );
  return useMemo(() => {
    const stage = challenge.stages[stageIndex]!;
    const results = evaluateStage(
      stage,
      doc,
      simulateStage(stage, doc),
      answers,
      exercisesUpTo(challenge, stageIndex),
    );
    return { results, passed: isStagePassed(results) };
  }, [challenge, stageIndex, doc, answers]);
}
