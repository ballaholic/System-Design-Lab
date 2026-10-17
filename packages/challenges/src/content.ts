import { type ArchitectureDocument, loadArchitecture, validateArchitecture } from "@sdl/architecture";
import { evaluateStage, type ExerciseAnswers, isStagePassed, simulateStage } from "./evaluate";
import {
  type ChallengeDefinition,
  ChallengeDefinitionSchema,
  type Exercise,
  type StageDefinition,
} from "./schema";

/** A stage with its brief read from the markdown file. */
export type Stage = StageDefinition & { briefMd: string };

/** A challenge ready to use: markdown read and the starter design loaded. */
export interface Challenge extends Omit<ChallengeDefinition, "stages"> {
  stages: Stage[];
  starter: ArchitectureDocument | null;
}

export interface ContentIssue {
  /** Where in the challenge, e.g. "stages[1].criteria[0]" or "s2-scale.md". */
  path: string;
  message: string;
}

/** Reads a file in the challenge folder by its relative name; undefined when it doesn't exist. */
export type ReadFile = (name: string) => string | undefined;

export type LoadChallengeResult = { ok: true; challenge: Challenge } | { ok: false; issues: ContentIssue[] };

/**
 * Validates and resolves one challenge folder (CI content check, API startup and the web app use the same rules):
 * schema, referenced files, unique ids, references between criteria, exercises and operations, a valid starter
 * design and, when reference solutions are given, that each stage is solvable and isn't passed by the starter.
 */
export function loadChallenge(
  raw: unknown,
  read: ReadFile,
  options: { solutions?: Record<string, unknown> } = {},
): LoadChallengeResult {
  const parsed = ChallengeDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
    };
  }
  const def = parsed.data as ChallengeDefinition;
  const issues: ContentIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });

  let starter: ArchitectureDocument | null = null;
  if (def.starterArchitecture) {
    starter = loadDesign(def.starterArchitecture, read(def.starterArchitecture), issue);
  }

  const unique = (kind: string, ids: Array<[string, string]>) => {
    const seen = new Set<string>();
    for (const [path, id] of ids) {
      if (seen.has(id)) issue(path, `Duplicate ${kind} id "${id}".`);
      seen.add(id);
    }
  };
  unique(
    "stage",
    def.stages.map((s, i) => [`stages[${i}]`, s.id]),
  );
  unique(
    "exercise",
    def.stages.flatMap((s, i) =>
      (s.exercises ?? []).map((e, j) => [`stages[${i}].exercises[${j}]`, e.id] as [string, string]),
    ),
  );
  unique(
    "hint",
    def.stages.flatMap((s, i) =>
      s.hints.map((h, j) => [`stages[${i}].hints[${j}]`, h.id] as [string, string]),
    ),
  );

  const operations = new Set(starter?.operations.map((o) => o.id));
  const known = new Map<string, Exercise>();
  const stages: Stage[] = def.stages.map((stage, i) => {
    const at = `stages[${i}]`;
    unique(
      "criterion",
      stage.criteria.map((c, j) => [`${at}.criteria[${j}]`, c.id]),
    );
    for (const e of stage.exercises ?? []) {
      known.set(e.id, e);
      if (e.kind === "decision")
        unique(
          "option",
          e.options.map((o, j) => [`${at}.exercises.${e.id}.options[${j}]`, o.id]),
        );
    }
    stage.criteria.forEach((c, j) => {
      const path = `${at}.criteria[${j}]`;
      if (c.kind === "exercise-completed" && !known.has(c.exerciseId)) {
        issue(path, `Refers to exercise "${c.exerciseId}", which isn't in this or an earlier stage.`);
      }
      if ((c.kind === "has-flow" || (c.kind === "sim-success-rate" && c.operation)) && starter) {
        const op = c.kind === "has-flow" ? c.operation : c.operation!;
        if (!operations.has(op))
          issue(path, `Refers to operation "${op}", which the starter design doesn't define.`);
      }
    });
    const briefMd = read(stage.brief);
    if (briefMd === undefined) issue(`${at}.brief`, `Missing file "${stage.brief}".`);
    else if (briefMd.trim() === "") issue(stage.brief, "The brief is empty.");
    return { ...stage, briefMd: briefMd ?? "" };
  });

  const challenge: Challenge = { ...def, stages, starter };
  if (issues.length === 0 && options.solutions) checkSolvable(challenge, options.solutions, issue);
  return issues.length === 0 ? { ok: true, challenge } : { ok: false, issues };
}

/** Exercises of a stage and every earlier one, by id. */
export function exercisesUpTo(
  challenge: { stages: StageDefinition[] },
  stageIndex: number,
): Map<string, Exercise> {
  return new Map(
    challenge.stages
      .slice(0, stageIndex + 1)
      .flatMap((s) => (s.exercises ?? []).map((e) => [e.id, e] as const)),
  );
}

function loadDesign(
  name: string,
  text: string | undefined,
  issue: (path: string, message: string) => void,
): ArchitectureDocument | null {
  if (text === undefined) {
    issue(name, "Missing file.");
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    issue(name, "Not valid JSON.");
    return null;
  }
  const loaded = loadArchitecture(json);
  if (!loaded.ok) {
    issue(name, loaded.error);
    return null;
  }
  if (loaded.repairs.length > 0) issue(name, `Needs repairs: ${loaded.repairs.join(" ")}`);
  return loaded.document;
}

function checkSolvable(
  challenge: Challenge,
  solutions: Record<string, unknown>,
  issue: (path: string, message: string) => void,
) {
  challenge.stages.forEach((stage, i) => {
    const exercises = exercisesUpTo(challenge, i);
    const answers = answerAll([...exercises.values()]);
    if (i === 0 && challenge.starter) {
      const results = evaluateStage(
        stage,
        challenge.starter,
        simulateStage(stage, challenge.starter),
        answers,
        exercises,
      );
      if (isStagePassed(results)) issue(`stages[0]`, "The starter design already passes the first stage.");
    }
    const raw = solutions[stage.id];
    if (raw === undefined) {
      issue(`solutions/${stage.id}.json`, "Missing reference solution.");
      return;
    }
    const doc = loadDesign(`solutions/${stage.id}.json`, JSON.stringify(raw), issue);
    if (!doc) return;
    const errors = validateArchitecture(doc).filter((v) => v.severity === "error");
    if (errors.length > 0) issue(`solutions/${stage.id}.json`, `Invalid design: ${errors[0]!.message}`);
    const failing = evaluateStage(stage, doc, simulateStage(stage, doc), answers, exercises).filter(
      (r) => !r.passed && !r.optional,
    );
    for (const r of failing) issue(`solutions/${stage.id}.json`, `Doesn't pass "${r.id}": ${r.detail}`);
  });
}

/** Answers every exercise correctly, to check solutions against the design criteria alone. */
function answerAll(exercises: Exercise[]): ExerciseAnswers {
  const at = "2026-01-01T00:00:00.000Z";
  return Object.fromEntries(
    exercises.map((e) => [
      e.id,
      e.kind === "estimate"
        ? { kind: "estimate", value: e.expected, correct: true, attempts: 1, revealed: false, answeredAt: at }
        : { kind: "decision", optionId: e.options[0]!.id, answeredAt: at },
    ]),
  );
}
