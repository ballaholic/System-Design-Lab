import {
  type ArchitectureDocument,
  buildGraph,
  CATALOG,
  type ComponentType,
  flowsOf,
  type NodeId,
  roleOf,
  walkSteps,
} from "@sdl/architecture";
import { type Failure, type FailureScenario, simulate, type SimulationResult } from "@sdl/simulation";
import type { Criterion, EstimateExercise, Exercise, StageDefinition } from "./schema";

// Criteria are evaluated in the browser and stored as evidence (ADR-010). Simulation criteria use the stage's
// traffic and failures, never the learner's sandbox settings, so passing a stage means something.

export type ExerciseAnswer =
  | {
      kind: "estimate";
      value: number;
      correct: boolean;
      attempts: number;
      revealed: boolean;
      answeredAt: string;
    }
  | { kind: "decision"; optionId: string; answeredAt: string };
export type ExerciseAnswers = Record<string, ExerciseAnswer>;

export interface CriterionResult {
  id: string;
  passed: boolean;
  /** Why, in the learner's terms, with the engine's numbers where there are any. */
  detail: string;
  optional?: boolean;
}

const EPSILON = 1e-9;

/** Within the exercise's relative tolerance of the expected value. */
export function checkEstimate(exercise: EstimateExercise, value: number): boolean {
  return (
    Number.isFinite(value) &&
    Math.abs(value - exercise.expected) <= exercise.tolerance * exercise.expected + EPSILON
  );
}

/** An exercise counts as done when a decision is made, or an estimate is right or its solution was revealed. */
export function isExerciseCompleted(exercise: Exercise, answer: ExerciseAnswer | undefined): boolean {
  if (!answer || answer.kind !== exercise.kind) return false;
  return answer.kind === "decision"
    ? exercise.kind === "decision" && exercise.options.some((o) => o.id === answer.optionId)
    : answer.correct || answer.revealed;
}

/**
 * Turns the stage's failure templates into failures on this design: the first component of the type, or the one
 * receiving the most writes at the stage's traffic. Templates with no matching component are dropped.
 */
export function stageScenario(stage: StageDefinition, doc: ArchitectureDocument): FailureScenario {
  const failures: Failure[] = [];
  let baseline: SimulationResult | undefined;
  for (const template of stage.scenario?.failures ?? []) {
    const candidates = doc.nodes.filter((n) => n.type === template.target.type);
    if (candidates.length === 0) continue;
    let target = candidates[0]!;
    if (template.target.pick === "most-writes" && candidates.length > 1) {
      baseline ??= simulate(doc, stage.traffic);
      const result = baseline;
      if (result.status === "ok") {
        const writes = (id: NodeId) => result.nodes[id]?.resources.write?.offered ?? 0;
        target = candidates.reduce((best, n) => (writes(n.id) > writes(best.id) ? n : best), target);
      }
    }
    failures.push(
      template.kind === "app-instance-failure"
        ? { kind: template.kind, nodeId: target.id, count: template.count ?? 1 }
        : ({ kind: template.kind, nodeId: target.id } as Failure),
    );
  }
  return { failures };
}

/** The simulation that criteria are checked against: stage traffic and stage failures. */
export function simulateStage(stage: StageDefinition, doc: ArchitectureDocument): SimulationResult {
  return simulate(doc, stage.traffic, stageScenario(stage, doc));
}

export function evaluateStage(
  stage: StageDefinition,
  doc: ArchitectureDocument,
  sim: SimulationResult,
  answers: ExerciseAnswers,
  /** Exercises from this and earlier stages, by id, so a criterion can refer to either. */
  exercises: ReadonlyMap<string, Exercise> = new Map((stage.exercises ?? []).map((e) => [e.id, e])),
): CriterionResult[] {
  return stage.criteria.map((criterion) => {
    const { passed, detail } = evaluateCriterion(criterion, doc, sim, answers, exercises);
    return { id: criterion.id, passed, detail, ...(criterion.optional ? { optional: true } : {}) };
  });
}

export function isStagePassed(results: readonly CriterionResult[]): boolean {
  return results.every((r) => r.passed || r.optional);
}

function evaluateCriterion(
  c: Criterion,
  doc: ArchitectureDocument,
  sim: SimulationResult,
  answers: ExerciseAnswers,
  exercises: ReadonlyMap<string, Exercise>,
): { passed: boolean; detail: string } {
  const typeName = (t: ComponentType) => CATALOG[t].name;
  switch (c.kind) {
    case "has-component": {
      const count = doc.nodes.filter(
        (n) => (!c.type || n.type === c.type) && (!c.category || CATALOG[n.type].category === c.category),
      ).length;
      const min = c.min ?? 1;
      const what = c.type ? typeName(c.type).toLowerCase() : `${c.category} component`;
      return { passed: count >= min, detail: `${count} ${what}${count === 1 ? "" : "s"} (needs ${min}).` };
    }
    case "path-exists": {
      const found = findPath(doc, c.fromRole, c.toType, c.via ?? []);
      const via = c.via?.length ? ` through ${c.via.map(typeName).join(" and ")}` : "";
      return {
        passed: found,
        detail: found
          ? `Connected${via}.`
          : `No connected path from a ${c.fromRole === "source" ? "client" : c.fromRole} to a ${typeName(c.toType)}${via}.`,
      };
    }
    case "has-flow": {
      const name = doc.operations.find((o) => o.id === c.operation)?.name ?? c.operation;
      let hasFlow = false;
      let usesStep = !c.usesStep;
      for (const node of doc.nodes) {
        const steps = flowsOf(node)[c.operation];
        if (!steps || steps.length === 0) continue;
        hasFlow = true;
        walkSteps(steps, (s) => {
          if (s.type === c.usesStep) usesStep = true;
        });
      }
      if (!hasFlow) return { passed: false, detail: `No server has steps for "${name}" yet.` };
      if (!usesStep) {
        return {
          passed: false,
          detail: `The "${name}" flow doesn't use a ${c.usesStep === "cache-lookup" ? "cache lookup" : "publish"} step.`,
        };
      }
      return { passed: true, detail: `A server handles "${name}".` };
    }
    case "exercise-completed": {
      const exercise = exercises.get(c.exerciseId);
      const done = exercise !== undefined && isExerciseCompleted(exercise, answers[c.exerciseId]);
      return { passed: done, detail: done ? "Done." : "Not answered yet." };
    }
    default:
      return evaluateSimCriterion(c, doc, sim);
  }
}

function evaluateSimCriterion(
  c: Extract<Criterion, { kind: `sim-${string}` }>,
  doc: ArchitectureDocument,
  sim: SimulationResult,
): { passed: boolean; detail: string } {
  if (sim.status !== "ok") {
    return {
      passed: false,
      detail: "The design has problems that block the simulation. See the Issues tab.",
    };
  }
  const label = (id: NodeId) => doc.nodes.find((n) => n.id === id)?.label ?? id;
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  switch (c.kind) {
    case "sim-success-rate": {
      const outcome = c.operation ? sim.operations[c.operation] : undefined;
      if (c.operation && (!outcome || outcome.offered === 0)) {
        return { passed: false, detail: "No traffic reaches this operation." };
      }
      const rate = outcome ? outcome.processingSuccessRate : sim.summary.processingSuccessRate;
      const offered = outcome ? outcome.offered : sim.summary.offered;
      if (offered === 0) return { passed: false, detail: "No traffic reaches the design." };
      return { passed: rate >= c.min - EPSILON, detail: `${pct(rate)} succeed (needs ${pct(c.min)}).` };
    }
    case "sim-no-saturation": {
      const saturated = doc.nodes.filter(
        (n) => (!c.types || c.types.includes(n.type)) && sim.nodes[n.id]?.status === "saturated",
      );
      return {
        passed: saturated.length === 0,
        detail:
          saturated.length === 0
            ? "Nothing is saturated."
            : `Saturated: ${saturated.map((n) => label(n.id)).join(", ")}.`,
      };
    }
    case "sim-max-utilization": {
      const nodes = doc.nodes.filter((n) => n.type === c.type);
      if (nodes.length === 0)
        return { passed: false, detail: `The design has no ${CATALOG[c.type].name.toLowerCase()}.` };
      const worst = Math.max(
        ...nodes.map((n) =>
          Math.max(0, ...Object.values(sim.nodes[n.id]?.resources ?? {}).map((r) => r.utilization)),
        ),
      );
      return {
        passed: worst <= c.max + EPSILON,
        detail: `Busiest at ${pct(worst)} (needs at most ${pct(c.max)}).`,
      };
    }
    case "sim-backlog-stable": {
      const growing = doc.nodes.filter((n) => {
        const role = roleOf(n.type);
        return (
          (role === "queue" || role === "stream") &&
          (!c.brokerType || n.type === c.brokerType) &&
          (sim.nodes[n.id]?.queue?.backlogGrowthPerSec ?? 0) > EPSILON
        );
      });
      return {
        passed: growing.length === 0,
        detail:
          growing.length === 0
            ? "Consumers keep up."
            : `Backlog growing in ${growing.map((n) => label(n.id)).join(", ")}.`,
      };
    }
  }
}

/** Whether a directed path leads from any component with `fromRole` to one of `toType`, visiting every `via` type. */
function findPath(
  doc: ArchitectureDocument,
  fromRole: string,
  toType: ComponentType,
  via: ComponentType[],
): boolean {
  const g = buildGraph(doc);
  const full = (1 << via.length) - 1;
  const maskOf = (id: NodeId) => {
    const type = g.nodes.get(id)!.type;
    return via.reduce((m, t, i) => (t === type ? m | (1 << i) : m), 0);
  };
  const seen = new Set<string>();
  const queue: Array<[NodeId, number]> = doc.nodes
    .filter((n) => roleOf(n.type) === fromRole)
    .map((n) => [n.id, maskOf(n.id)]);
  while (queue.length > 0) {
    const [id, mask] = queue.shift()!;
    const key = `${id}\u0000${mask}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (g.nodes.get(id)!.type === toType && mask === full) return true;
    for (const e of g.outgoing.get(id) ?? [])
      if (g.nodes.has(e.target)) queue.push([e.target, mask | maskOf(e.target)]);
  }
  return false;
}
