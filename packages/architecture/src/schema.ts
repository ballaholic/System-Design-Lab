import { z } from "zod";
import { CATALOG, COMPONENT_TYPES, type ComponentConfig, type ComponentType, hasFlows } from "./catalog";
import { ID_PATTERN, OPERATION_ID_PATTERN } from "./ids";
import { LIMITS } from "./limits";

export const CURRENT_SCHEMA_VERSION = 1;

const Id = z.string().regex(ID_PATTERN);
const OperationIdSchema = z.string().regex(OPERATION_ID_PATTERN);
const Label = z.string().trim().min(1).max(LIMITS.labelLength);

export const OperationSchema = z.object({
  id: OperationIdSchema,
  name: z.string().trim().min(1).max(LIMITS.operationNameLength),
  kind: z.enum(["read", "write"]),
  /** Relative weight in the traffic mix. 0 marks an internal or message-only operation. */
  share: z.number().min(0).max(1_000_000),
});

const CallStep = z.object({
  type: z.literal("call"),
  edge: Id,
  operation: OperationIdSchema.optional(),
  as: z.enum(["read", "write"]).optional(),
  optional: z.boolean().optional(),
});

const PublishStep = z.object({
  type: z.literal("publish"),
  edge: Id,
  message: OperationIdSchema.optional(),
  optional: z.boolean().optional(),
});

// Nesting is spelled out level by level instead of recursively (LIMITS.flowNesting = 3), so the schema itself
// limits depth and the generated JSON Schema has no recursive references. The deepest list can't hold a lookup.
const Level3 = z.array(z.discriminatedUnion("type", [CallStep, PublishStep])).max(LIMITS.stepsPerFlow);
const Lookup2 = z.object({
  type: z.literal("cache-lookup"),
  edge: Id,
  onMiss: Level3,
  populate: z.boolean().optional(),
});
const Level2 = z
  .array(z.discriminatedUnion("type", [CallStep, PublishStep, Lookup2]))
  .max(LIMITS.stepsPerFlow);
const Lookup1 = z.object({
  type: z.literal("cache-lookup"),
  edge: Id,
  onMiss: Level2,
  populate: z.boolean().optional(),
});
const Level1 = z
  .array(z.discriminatedUnion("type", [CallStep, PublishStep, Lookup1]))
  .max(LIMITS.stepsPerFlow);

export const FlowStepsSchema = Level1;
const Flows = z.record(OperationIdSchema, Level1);

function nodeSchema(type: ComponentType) {
  const def = CATALOG[type];
  const base = { id: Id, type: z.literal(type), label: Label, config: def.configSchema };
  return hasFlows(def.role) ? z.object({ ...base, flows: Flows.optional() }) : z.object(base);
}

const nodeSchemas = COMPONENT_TYPES.map(nodeSchema);
export const NodeSchema = z.discriminatedUnion(
  "type",
  nodeSchemas as [(typeof nodeSchemas)[number], ...typeof nodeSchemas],
);

export const EdgeSchema = z.object({
  id: Id,
  source: Id,
  target: Id,
  label: z.string().trim().max(LIMITS.labelLength).optional(),
});

export const PositionSchema = z.object({
  x: z.number().min(-1e6).max(1e6),
  y: z.number().min(-1e6).max(1e6),
});

export const EDGE_SIDES = ["top", "right", "bottom", "left"] as const;
/** The left side is where connections come in, so a connection never leaves from it. */
export const SOURCE_SIDES = ["top", "right", "bottom"] as const;

/** Which side of each box a connection leaves and enters. Unset sides default to right (out) and left (in). */
export const EdgeSidesSchema = z.object({
  source: z.enum(SOURCE_SIDES).optional(),
  target: z.enum(EDGE_SIDES).optional(),
});

export const TrafficProfileSchema = z.object({
  totalRps: z.number().gt(0).max(LIMITS.maxTotalRps),
  mix: z.record(OperationIdSchema, z.number().min(0)).optional(),
});

export const ArchitectureDocumentSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  operations: z.array(OperationSchema).min(1).max(LIMITS.operations),
  nodes: z.array(NodeSchema).max(LIMITS.nodes),
  edges: z.array(EdgeSchema).max(LIMITS.edges),
  /** Presentation only; the simulator ignores it (ADR-015). */
  layout: z.record(Id, PositionSchema),
  /** Presentation only, like layout: connection sides keyed by edge id. */
  edgeLayout: z.record(Id, EdgeSidesSchema).optional(),
  notes: z.string().max(LIMITS.notesLength).optional(),
  /** Last-used simulation inputs. */
  traffic: TrafficProfileSchema.optional(),
});

// Types are written out rather than inferred: the catalog-driven node schema is too dynamic for useful inference.
// The schema tests check that parsing produces these shapes.

export type NodeId = string;
export type EdgeId = string;
export type OperationId = string;
export type OperationKind = "read" | "write";

export interface Operation {
  id: OperationId;
  name: string;
  kind: OperationKind;
  share: number;
}

/** One flow step at any depth. The schema limits nesting to three levels. */
export type FlowStep =
  | { type: "call"; edge: EdgeId; operation?: OperationId; as?: OperationKind; optional?: boolean }
  | { type: "cache-lookup"; edge: EdgeId; onMiss: FlowStep[]; populate?: boolean }
  | { type: "publish"; edge: EdgeId; message?: OperationId; optional?: boolean };
export type FlowStepType = FlowStep["type"];
export type Flows = Record<OperationId, FlowStep[]>;

export type FlowNodeType = "api-server" | "background-worker";

type NodeOf<T extends ComponentType> = {
  id: NodeId;
  type: T;
  label: string;
  config: ComponentConfig<T>;
} & (T extends FlowNodeType ? { flows?: Flows } : unknown);

export type ArchNode = { [T in ComponentType]: NodeOf<T> }[ComponentType];

export interface ArchEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  label?: string;
}

export interface Position {
  x: number;
  y: number;
}

export type EdgeSide = (typeof EDGE_SIDES)[number];
export type SourceSide = (typeof SOURCE_SIDES)[number];

export interface EdgeSides {
  source?: SourceSide;
  target?: EdgeSide;
}

export interface TrafficProfile {
  totalRps: number;
  mix?: Record<OperationId, number>;
}

export interface ArchitectureDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  operations: Operation[];
  nodes: ArchNode[];
  edges: ArchEdge[];
  layout: Record<NodeId, Position>;
  edgeLayout?: Record<EdgeId, EdgeSides>;
  notes?: string;
  traffic?: TrafficProfile;
}

/** Service and worker nodes, which can have flows. */
export type FlowNode = Extract<ArchNode, { type: FlowNodeType }>;

export function isFlowNode(node: ArchNode): node is FlowNode {
  return hasFlows(CATALOG[node.type].role);
}

export function flowsOf(node: ArchNode): Flows {
  return isFlowNode(node) ? (node.flows ?? {}) : {};
}
