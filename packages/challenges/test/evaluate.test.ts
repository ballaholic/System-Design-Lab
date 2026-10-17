import { readFileSync } from "node:fs";
import { type ArchitectureDocument, createEmptyDocument } from "@sdl/architecture";
import { simulate } from "@sdl/simulation";
import { describe, expect, it } from "vitest";
import {
  checkEstimate,
  type Criterion,
  evaluateStage,
  type ExerciseAnswers,
  exercisesUpTo,
  isExerciseCompleted,
  isStagePassed,
  simulateStage,
  type StageDefinition,
  stageScenario,
} from "../src";
import { CONTENT_DIR, loadChallengeDir } from "./files";

const loaded = loadChallengeDir(`${CONTENT_DIR}/url-shortener`);
if (!loaded.ok) throw new Error("content invalid");
const challenge = loaded.challenge;
const solution = (stage: string) =>
  JSON.parse(
    readFileSync(`${CONTENT_DIR}/url-shortener/solutions/${stage}.json`, "utf8"),
  ) as ArchitectureDocument;

function stage(criteria: Criterion[], extra: Partial<StageDefinition> = {}): StageDefinition {
  return {
    id: "t",
    title: "Test",
    brief: "t.md",
    traffic: { totalRps: 11_000 },
    hints: [],
    criteria,
    ...extra,
  };
}

const run = (s: StageDefinition, doc: ArchitectureDocument, answers: ExerciseAnswers = {}) =>
  evaluateStage(s, doc, simulateStage(s, doc), answers);

describe("criteria", () => {
  const s1 = solution("s1-baseline");
  const s2 = solution("s2-viral");

  it("has-component counts by type, category and minimum", () => {
    const results = run(
      stage([
        { kind: "has-component", id: "a", description: "", type: "redis-cache" },
        { kind: "has-component", id: "b", description: "", category: "storage", min: 1 },
        { kind: "has-component", id: "c", description: "", category: "application", min: 3 },
      ]),
      s2,
    );
    expect(results.map((r) => r.passed)).toEqual([true, true, false]);
    expect(results[2]!.detail).toBe("2 application components (needs 3).");
    expect(
      run(stage([{ kind: "has-component", id: "a", description: "", type: "redis-cache" }]), s1)[0],
    ).toMatchObject({
      passed: false,
      detail: "0 caches (needs 1).",
    });
  });

  it("path-exists follows connections and requires every via type", () => {
    const path = (via: Criterion & { kind: "path-exists" }) => run(stage([via]), s1)[0]!;
    expect(
      path({
        kind: "path-exists",
        id: "p",
        description: "",
        fromRole: "source",
        toType: "sql-database",
        via: ["load-balancer", "api-server"],
      }).passed,
    ).toBe(true);
    const missing = path({
      kind: "path-exists",
      id: "p",
      description: "",
      fromRole: "source",
      toType: "sql-database",
      via: ["redis-cache"],
    });
    expect(missing).toMatchObject({
      passed: false,
      detail: "No connected path from a client to a SQL database through Cache.",
    });
    expect(
      path({ kind: "path-exists", id: "p", description: "", fromRole: "service", toType: "web-client" })
        .passed,
    ).toBe(false);
  });

  it("has-flow checks for steps and, optionally, a step type", () => {
    const results = run(
      stage([
        { kind: "has-flow", id: "a", description: "", operation: "redirect" },
        { kind: "has-flow", id: "b", description: "", operation: "redirect", usesStep: "cache-lookup" },
        { kind: "has-flow", id: "c", description: "", operation: "create", usesStep: "publish" },
      ]),
      s1,
    );
    expect(results.map((r) => r.passed)).toEqual([true, false, false]);
    expect(results[1]!.detail).toBe('The "Follow short link" flow doesn\'t use a cache lookup step.');
    expect(
      run(
        stage([{ kind: "has-flow", id: "a", description: "", operation: "redirect" }]),
        createEmptyDocument(),
      )[0]!.detail,
    ).toBe('No server has steps for "redirect" yet.');
  });

  it("simulation criteria use the stage's traffic, not the design's saved traffic", () => {
    const sandbox = { ...s1, traffic: { totalRps: 10 } };
    const criteria: Criterion[] = [
      { kind: "sim-success-rate", id: "ok", description: "", min: 0.999 },
      { kind: "sim-no-saturation", id: "sat", description: "" },
    ];
    expect(isStagePassed(run(stage(criteria, { traffic: { totalRps: 128 } }), sandbox))).toBe(true);
    const busy = run(stage(criteria), sandbox);
    expect(busy.map((r) => r.passed)).toEqual([false, false]);
    expect(busy[1]!.detail).toBe("Saturated: API server."); // 2 instances cap what reaches the database
    expect(busy[0]!.detail).toMatch(/succeed \(needs 99\.9%\)\.$/);
  });

  it("sim-success-rate can target one operation, and needs traffic", () => {
    const results = run(
      stage([
        { kind: "sim-success-rate", id: "r", description: "", operation: "redirect", min: 0.75 },
        { kind: "sim-success-rate", id: "x", description: "", operation: "missing", min: 0.5 },
      ]),
      s2,
    );
    expect(results.map((r) => r.passed)).toEqual([true, false]);
    expect(results[1]!.detail).toBe("No traffic reaches this operation.");
  });

  it("sim-max-utilization and sim-backlog-stable read node results", () => {
    const results = run(
      stage([
        { kind: "sim-max-utilization", id: "u", description: "", type: "sql-database", max: 0.5 },
        { kind: "sim-max-utilization", id: "v", description: "", type: "api-server", max: 0.5 },
        { kind: "sim-max-utilization", id: "w", description: "", type: "event-stream", max: 0.5 },
        { kind: "sim-backlog-stable", id: "b", description: "" },
      ]),
      s2,
    );
    expect(results.map((r) => r.passed)).toEqual([true, false, false, true]);
    expect(results[1]!.detail).toBe("Busiest at 68.8% (needs at most 50%).");
    expect(results[2]!.detail).toBe("The design has no event stream.");
  });

  it("reports a growing backlog", () => {
    const doc = structuredClone(s1);
    doc.nodes.push(
      { id: "q", type: "message-queue", label: "Queue", config: { enqueueCapacity: 50_000 } },
      {
        id: "w",
        type: "background-worker",
        label: "Worker",
        config: { instances: 1, throughputPerInstance: 10 },
        flows: { create: [] },
      },
    );
    doc.edges.push({ id: "api-q", source: "api", target: "q" }, { id: "q-w", source: "q", target: "w" });
    const api = doc.nodes.find((n) => n.id === "api") as { flows: Record<string, unknown[]> };
    api.flows.create = [...api.flows.create!, { type: "publish", edge: "api-q" }];
    const [result] = run(
      stage([{ kind: "sim-backlog-stable", id: "b", description: "", brokerType: "message-queue" }], {
        traffic: { totalRps: 128 },
      }),
      doc,
    );
    expect(result).toMatchObject({ passed: false, detail: "Backlog growing in Queue." });
  });

  it("simulation criteria fail with a clear reason when the design can't be simulated", () => {
    const doc = structuredClone(s1);
    doc.edges.push({ id: "db-users", source: "db", target: "users" });
    const [result] = run(stage([{ kind: "sim-success-rate", id: "s", description: "", min: 0.5 }]), doc);
    expect(result).toMatchObject({
      passed: false,
      detail: "The design has problems that block the simulation. See the Issues tab.",
    });
  });

  it("optional criteria don't block a stage", () => {
    expect(
      isStagePassed([
        { id: "a", passed: true, detail: "" },
        { id: "b", passed: false, detail: "", optional: true },
      ]),
    ).toBe(true);
    expect(isStagePassed([{ id: "a", passed: false, detail: "" }])).toBe(false);
    const [r] = run(
      stage([{ kind: "has-component", id: "o", description: "", type: "cdn", optional: true }]),
      s1,
    );
    expect(r).toMatchObject({ passed: false, optional: true });
  });
});

describe("exercises", () => {
  const estimate = challenge.stages[0]!.exercises!.find((e) => e.id === "est-redirect-rate")!;
  const decision = challenge.stages[0]!.exercises!.find((e) => e.id === "id-generation")!;
  if (estimate.kind !== "estimate" || decision.kind !== "decision") throw new Error("fixture");

  it("accepts estimates within the relative tolerance and rejects the rest", () => {
    expect(checkEstimate(estimate, 116)).toBe(true);
    expect(checkEstimate(estimate, 150)).toBe(true); // +29%
    expect(checkEstimate(estimate, 82)).toBe(true); // -29%
    expect(checkEstimate(estimate, 151)).toBe(false);
    expect(checkEstimate(estimate, 1_160)).toBe(false);
    expect(checkEstimate(estimate, Number.NaN)).toBe(false);
  });

  it("counts an estimate done when right or revealed, and a decision done when a real option is chosen", () => {
    const at = "2026-10-17T00:00:00Z";
    expect(isExerciseCompleted(estimate, undefined)).toBe(false);
    expect(
      isExerciseCompleted(estimate, {
        kind: "estimate",
        value: 1,
        correct: false,
        attempts: 1,
        revealed: false,
        answeredAt: at,
      }),
    ).toBe(false);
    expect(
      isExerciseCompleted(estimate, {
        kind: "estimate",
        value: 1,
        correct: false,
        attempts: 1,
        revealed: true,
        answeredAt: at,
      }),
    ).toBe(true);
    expect(
      isExerciseCompleted(estimate, {
        kind: "estimate",
        value: 116,
        correct: true,
        attempts: 2,
        revealed: false,
        answeredAt: at,
      }),
    ).toBe(true);
    expect(isExerciseCompleted(decision, { kind: "decision", optionId: "random", answeredAt: at })).toBe(
      true,
    );
    expect(isExerciseCompleted(decision, { kind: "decision", optionId: "nope", answeredAt: at })).toBe(false);
    expect(
      isExerciseCompleted(decision, {
        kind: "estimate",
        value: 1,
        correct: true,
        attempts: 1,
        revealed: false,
        answeredAt: at,
      }),
    ).toBe(false);
  });

  it("lets a stage's criteria refer to exercises from earlier stages", () => {
    expect([...exercisesUpTo(challenge, 1).keys()]).toEqual([
      "est-redirect-rate",
      "est-storage",
      "id-generation",
      "redirect-status",
    ]);
    const s = stage([{ kind: "exercise-completed", id: "e", description: "", exerciseId: "id-generation" }]);
    const answers: ExerciseAnswers = {
      "id-generation": { kind: "decision", optionId: "random", answeredAt: "x" },
    };
    expect(
      evaluateStage(
        s,
        createEmptyDocument(),
        simulate(createEmptyDocument(), s.traffic),
        answers,
        exercisesUpTo(challenge, 1),
      )[0]!.passed,
    ).toBe(true);
    expect(
      evaluateStage(s, createEmptyDocument(), simulate(createEmptyDocument(), s.traffic), answers)[0],
    ).toMatchObject({ passed: false, detail: "Not answered yet." });
  });
});

describe("stage scenarios", () => {
  const outage = challenge.stages[2]!;

  it("takes down the database that receives the writes, not just the first one", () => {
    const doc = structuredClone(solution("s2-viral"));
    // An idle reporting database listed first must not be the one that fails.
    doc.nodes.unshift({
      id: "reports",
      type: "sql-database",
      label: "Reports",
      config: { readCapacity: 5000, writeCapacity: 2000 },
    });
    expect(stageScenario(outage, doc)).toEqual({
      failures: [{ kind: "database-primary-down", nodeId: "db" }],
    });
  });

  it("picks the first match, adds instance counts, and skips templates with no match", () => {
    const s = stage([], {
      scenario: {
        failures: [
          { kind: "app-instance-failure", target: { type: "api-server" }, count: 3 },
          { kind: "cache-down", target: { type: "redis-cache" } },
          { kind: "worker-down", target: { type: "background-worker" } },
        ],
      },
    });
    expect(stageScenario(s, solution("s2-viral")).failures).toEqual([
      { kind: "app-instance-failure", nodeId: "api", count: 3 },
      { kind: "cache-down", nodeId: "cache" },
    ]);
    expect(stageScenario(stage([]), solution("s1-baseline"))).toEqual({ failures: [] });
  });

  it("stage 3: redirects survive at about the hit rate while creates fail", () => {
    const doc = solution("s3-outage");
    const sim = simulateStage(outage, doc);
    if (sim.status !== "ok") throw new Error("invalid");
    expect(sim.operations.redirect!.processingSuccessRate).toBeCloseTo(0.8);
    expect(sim.operations.create!.processingSuccessRate).toBe(0);
  });
});
