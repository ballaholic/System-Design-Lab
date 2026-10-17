import type { FlowStep } from "@sdl/architecture";

/** Index path to a step: `[2]` is the third top-level step, `[2, 0]` the first on-miss step inside it. */
export type StepPath = readonly number[];

function mapList(steps: FlowStep[], path: StepPath, fn: (list: FlowStep[]) => FlowStep[]): FlowStep[] {
  if (path.length === 0) return fn(steps);
  const [head, ...rest] = path as [number, ...number[]];
  return steps.map((step, i) => {
    if (i !== head || step.type !== "cache-lookup") return step;
    return { ...step, onMiss: mapList(step.onMiss, rest, fn) };
  });
}

const parentOf = (path: StepPath) => path.slice(0, -1);
const indexOf = (path: StepPath) => path[path.length - 1]!;

export function updateStepAt(
  steps: FlowStep[],
  path: StepPath,
  fn: (step: FlowStep) => FlowStep,
): FlowStep[] {
  return mapList(steps, parentOf(path), (list) => list.map((s, i) => (i === indexOf(path) ? fn(s) : s)));
}

export function removeStepAt(steps: FlowStep[], path: StepPath): FlowStep[] {
  return mapList(steps, parentOf(path), (list) => list.filter((_, i) => i !== indexOf(path)));
}

/** Moves a step up (-1) or down (+1) within its own list. Out-of-range moves are ignored. */
export function moveStepAt(steps: FlowStep[], path: StepPath, delta: -1 | 1): FlowStep[] {
  return mapList(steps, parentOf(path), (list) => {
    const from = indexOf(path);
    const to = from + delta;
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    [next[from], next[to]] = [next[to]!, next[from]!];
    return next;
  });
}

/** Appends a step to the list at `listPath`: `[]` is the flow itself, `[i]` the on-miss list of lookup `i`. */
export function appendStep(steps: FlowStep[], listPath: StepPath, step: FlowStep): FlowStep[] {
  return mapList(steps, listPath, (list) => [...list, step]);
}
