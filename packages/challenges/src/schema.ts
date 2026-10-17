import {
  CATEGORIES,
  COMPONENT_TYPES,
  type ComponentCategory,
  type ComponentRole,
  type ComponentType,
  TrafficProfileSchema,
} from "@sdl/architecture";
import type { TrafficProfile } from "@sdl/architecture";
import { FAILURE_KINDS, type FailureKind } from "@sdl/simulation";
import { z } from "zod";

// Challenge definitions are content files (ADR-008, DATA_MODEL §3). The schema is the contract for authors, the
// web app and the API, which validates content at startup against the generated JSON Schema.

export const CHALLENGE_SCHEMA_VERSION = 1;

const ROLES = [
  "source",
  "distributor",
  "edge-cache",
  "service",
  "consumer",
  "cache",
  "store",
  "queue",
  "stream",
] as const satisfies readonly ComponentRole[];

const Slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(60);
/** Stage, exercise, hint, option and criterion ids: lowercase words joined by hyphens. */
const LocalId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(60);
const OperationId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const Text = z.string().trim().min(1).max(500);
const Markdown = z.string().trim().min(1).max(10_000);
const MarkdownFile = z.string().regex(/^[a-z0-9-]+\.md$/);
const ComponentTypeSchema = z.enum(COMPONENT_TYPES as [ComponentType, ...ComponentType[]]);
const CategorySchema = z.enum(CATEGORIES.map((c) => c.id) as [ComponentCategory, ...ComponentCategory[]]);

const FailureTemplateSchema = z.object({
  kind: z.enum(FAILURE_KINDS as [FailureKind, ...FailureKind[]]),
  /** Which component fails: the first of this type in the design, or the one taking the most writes. */
  target: z.object({ type: ComponentTypeSchema, pick: z.enum(["first", "most-writes"]).optional() }),
  /** app-instance-failure only. */
  count: z.number().int().min(1).max(1000).optional(),
});

const EstimateSchema = z.object({
  kind: z.literal("estimate"),
  id: LocalId,
  prompt: Text,
  unit: z.string().trim().min(1).max(30),
  expected: z.number().positive(),
  /** Accepted relative error, e.g. 0.25 accepts answers within ±25% of `expected`. */
  tolerance: z.number().gt(0).max(1),
  workedSolution: Markdown,
});

const DecisionSchema = z.object({
  kind: z.literal("decision"),
  id: LocalId,
  prompt: Text,
  options: z
    .array(z.object({ id: LocalId, label: Text, feedback: Markdown, recommended: z.boolean().optional() }))
    .min(2)
    .max(6),
});

const ExerciseSchema = z.discriminatedUnion("kind", [EstimateSchema, DecisionSchema]);

const base = { id: LocalId, description: Text, optional: z.boolean().optional() };
const CriterionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("has-component"),
    ...base,
    category: CategorySchema.optional(),
    type: ComponentTypeSchema.optional(),
    min: z.number().int().min(1).optional(),
  }),
  z.object({
    kind: z.literal("path-exists"),
    ...base,
    fromRole: z.enum(ROLES),
    toType: ComponentTypeSchema,
    via: z.array(ComponentTypeSchema).max(5).optional(),
  }),
  z.object({
    kind: z.literal("has-flow"),
    ...base,
    operation: OperationId,
    usesStep: z.enum(["cache-lookup", "publish"]).optional(),
  }),
  z.object({
    kind: z.literal("sim-success-rate"),
    ...base,
    operation: OperationId.optional(),
    min: z.number().min(0).max(1),
  }),
  z.object({ kind: z.literal("sim-backlog-stable"), ...base, brokerType: ComponentTypeSchema.optional() }),
  z.object({
    kind: z.literal("sim-no-saturation"),
    ...base,
    types: z.array(ComponentTypeSchema).max(13).optional(),
  }),
  z.object({
    kind: z.literal("sim-max-utilization"),
    ...base,
    type: ComponentTypeSchema,
    max: z.number().gt(0).max(10),
  }),
  z.object({ kind: z.literal("exercise-completed"), ...base, exerciseId: LocalId }),
]);

const StageSchema = z.object({
  id: LocalId,
  title: Text,
  /** Markdown file in the challenge folder: the stage's story and requirements. */
  brief: MarkdownFile,
  /** The load criteria are checked at, whatever the learner's sandbox traffic is. */
  traffic: TrafficProfileSchema,
  scenario: z.object({ failures: z.array(FailureTemplateSchema).min(1).max(5) }).optional(),
  exercises: z.array(ExerciseSchema).max(6).optional(),
  hints: z.array(z.object({ id: LocalId, md: Markdown })).max(6),
  criteria: z.array(CriterionSchema).min(1).max(12),
});

export const ChallengeDefinitionSchema = z.object({
  schemaVersion: z.literal(CHALLENGE_SCHEMA_VERSION),
  slug: Slug,
  /** Bump when criteria change; attempts record the version they started on. */
  version: z.number().int().min(1),
  title: Text,
  summary: Text,
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  topics: z.array(LocalId).min(1).max(8),
  /** Curriculum order, used for "recommended next". */
  order: z.number().int().min(1),
  /** Attribution only (ADR-024): no reproduced text. */
  reference: z.object({ source: Text, chapter: z.number().int().min(1).optional() }).optional(),
  objectives: z.array(Text).min(1).max(10),
  functionalRequirements: z.array(Text).min(1).max(10),
  nonFunctionalRequirements: z.array(Text).max(10),
  constraints: z.array(Text).max(10),
  /** JSON file in the challenge folder with the design learners start from. */
  starterArchitecture: z
    .string()
    .regex(/^[a-z0-9-]+\.json$/)
    .optional(),
  allowedComponents: z.array(ComponentTypeSchema).min(1).optional(),
  stages: z.array(StageSchema).min(1).max(10),
});

// Types are written out (as in @sdl/architecture) so editors show readable shapes.

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface FailureTemplate {
  kind: FailureKind;
  target: { type: ComponentType; pick?: "first" | "most-writes" };
  count?: number;
}

export type EstimateExercise = {
  kind: "estimate";
  id: string;
  prompt: string;
  unit: string;
  expected: number;
  tolerance: number;
  workedSolution: string;
};

export type DecisionExercise = {
  kind: "decision";
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string; feedback: string; recommended?: boolean }>;
};

export type Exercise = EstimateExercise | DecisionExercise;

type CriterionBase = { id: string; description: string; optional?: boolean };
export type Criterion = CriterionBase &
  (
    | { kind: "has-component"; category?: ComponentCategory; type?: ComponentType; min?: number }
    | { kind: "path-exists"; fromRole: ComponentRole; toType: ComponentType; via?: ComponentType[] }
    | { kind: "has-flow"; operation: string; usesStep?: "cache-lookup" | "publish" }
    | { kind: "sim-success-rate"; operation?: string; min: number }
    | { kind: "sim-backlog-stable"; brokerType?: ComponentType }
    | { kind: "sim-no-saturation"; types?: ComponentType[] }
    | { kind: "sim-max-utilization"; type: ComponentType; max: number }
    | { kind: "exercise-completed"; exerciseId: string }
  );
export type CriterionKind = Criterion["kind"];

export interface StageDefinition {
  id: string;
  title: string;
  brief: string;
  traffic: TrafficProfile;
  scenario?: { failures: FailureTemplate[] };
  exercises?: Exercise[];
  hints: Array<{ id: string; md: string }>;
  criteria: Criterion[];
}

export interface ChallengeDefinition {
  schemaVersion: typeof CHALLENGE_SCHEMA_VERSION;
  slug: string;
  version: number;
  title: string;
  summary: string;
  difficulty: Difficulty;
  topics: string[];
  order: number;
  reference?: { source: string; chapter?: number };
  objectives: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  constraints: string[];
  starterArchitecture?: string;
  allowedComponents?: ComponentType[];
  stages: StageDefinition[];
}

export const CRITERION_KINDS: readonly CriterionKind[] = [
  "has-component",
  "path-exists",
  "has-flow",
  "sim-success-rate",
  "sim-backlog-stable",
  "sim-no-saturation",
  "sim-max-utilization",
  "exercise-completed",
];

/** JSON Schema for the API (ARCHITECTURE §4), in input mode like the architecture schema. */
export function toChallengeJsonSchema(): Record<string, unknown> {
  return {
    $id: `https://systemdesignlab.dev/schemas/challenge.v${CHALLENGE_SCHEMA_VERSION}.schema.json`,
    title: "System Design Lab challenge definition",
    ...z.toJSONSchema(ChallengeDefinitionSchema, { io: "input", target: "draft-2020-12" }),
  };
}
