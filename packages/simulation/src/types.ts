import type { ComponentType, EdgeId, NodeId, OperationId, ValidationIssue } from "@sdl/architecture";
import type { AssumptionId } from "./assumptions";

export type { TrafficProfile } from "@sdl/architecture";

/** Stores have separate read and write capacity; everything else has one "total" capacity. */
export type Resource = "total" | "read" | "write";

export type Failure =
  | { kind: "database-primary-down"; nodeId: NodeId }
  | { kind: "cache-down"; nodeId: NodeId }
  | { kind: "app-instance-failure"; nodeId: NodeId; count: number }
  | { kind: "worker-down"; nodeId: NodeId };

export type FailureKind = Failure["kind"];

export interface FailureScenario {
  failures: Failure[];
}

export interface ResourceResult {
  capacity: number;
  offered: number;
  /** For background workers: messages consumed. Workers never reject; the rest stays in the backlog. */
  admitted: number;
  rejected: number;
  utilization: number;
}

export type NodeStatus = "ok" | "warm" | "saturated" | "down" | "idle";

export interface CacheResult {
  /** Requests that checked the cache (for a CDN: cacheable requests it admitted). */
  lookups: number;
  hits: number;
  misses: number;
  effectiveHitRate: number;
  /** Cache: calls such as writes and invalidations. CDN: requests forwarded without a lookup. */
  otherOps: number;
  populateOffered: number;
  populateAdmitted: number;
}

export interface BrokerResult {
  kind: "queue" | "stream";
  inflow: number;
  accepted: number;
  /** Messages consumed per second, summed over consumers (streams: over consumer groups). */
  consumed: number;
  /** Messages per second added to the backlog (streams: total lag growth over all consumer groups). */
  backlogGrowthPerSec: number;
  consumerGroups: number;
  secondsToFull?: number;
}

export interface NodeResult {
  status: NodeStatus;
  resources: Partial<Record<Resource, ResourceResult>>;
  byOperation: Record<OperationId, { offered: number; admitted: number }>;
  /** API gateways: requests per second rejected by the rate limit. */
  rateLimited?: number;
  cache?: CacheResult;
  queue?: BrokerResult;
  /** Lowest capacity / offered over this node's resources; absent when it receives nothing. */
  headroom?: number;
  /** Engine-generated "why" lines. */
  explanation: string[];
}

export interface Publication {
  nodeId: NodeId;
  /** The flow the publish step belongs to. */
  operation: OperationId;
  /** Index path of the step within that flow: `[1]`, or `[0, 2]` inside a lookup's on-miss steps. */
  stepPath: number[];
  brokerId: NodeId;
  message: OperationId;
  attempted: number;
  published: number;
}

export interface OperationOutcome {
  /** Requests per second entering from clients. */
  offered: number;
  /** Admitted by the entry node (the first component after the client). */
  accepted: number;
  /** Synchronous flow completed: every required step succeeded. */
  processingSucceeded: number;
  processingSuccessRate: number;
  publications: Publication[];
}

export interface DeliveryOutcome {
  brokerId: NodeId;
  consumerId: NodeId;
  message: OperationId;
  inflow: number;
  consumed: number;
  backlogGrowthPerSec: number;
  /** Success of consumed messages; null when nothing is consumed. */
  consumerSuccessRate: number | null;
}

export type SimEventKind =
  "saturated" | "rate-limited" | "down" | "unroutable" | "backlog-growing" | "idle" | "unmodeled";

export interface SimEvent {
  kind: SimEventKind;
  message: string;
  nodeIds: NodeId[];
}

export interface Bottleneck {
  nodeId: NodeId;
  resource: Resource;
  utilization: number;
}

export interface CapacityAnalysis {
  /** RPS at which the first component saturates; null when nothing is constrained. */
  breakingPointRps: number | null;
  firstSaturation?: { nodeId: NodeId; resource: Resource };
  /** API servers and background workers: instances needed to stay at or below the target utilization. */
  instancesNeeded: Record<NodeId, number>;
  targetUtilization: number;
}

export interface SimulationSummary {
  offered: number;
  processingSucceeded: number;
  processingSuccessRate: number;
  bottlenecks: Bottleneck[];
}

interface ResultBase {
  engineVersion: string;
  /** Hash of (document without layout and notes, traffic, scenario). Same hash, same result. */
  inputHash: string;
  issues: ValidationIssue[];
  assumptions: AssumptionId[];
}

export interface ValidSimulationResult extends ResultBase {
  status: "ok";
  nodes: Record<NodeId, NodeResult>;
  /** Requests or messages per second over each connection. */
  edges: Record<EdgeId, number>;
  operations: Record<OperationId, OperationOutcome>;
  deliveries: DeliveryOutcome[];
  summary: SimulationSummary;
  capacity: CapacityAnalysis;
  events: SimEvent[];
}

export interface InvalidSimulationResult extends ResultBase {
  status: "invalid";
}

export type SimulationResult = ValidSimulationResult | InvalidSimulationResult;

export interface SweepPoint {
  rps: number;
  processingSuccessRate: number;
  operations: Record<OperationId, number>;
  /** The most utilized saturated resource at this load, if any. */
  firstSaturated?: { nodeId: NodeId; resource: Resource };
}

export interface SweepOptions {
  /** Highest RPS; defaults to twice the breaking point (or twice the current RPS when nothing saturates). */
  maxRps?: number;
  /** Number of points, evenly spaced from maxRps / points to maxRps. Default 50. */
  points?: number;
}

export type SweepResult =
  | {
      status: "ok";
      engineVersion: string;
      inputHash: string;
      issues: ValidationIssue[];
      breakingPointRps: number | null;
      points: SweepPoint[];
    }
  | { status: "invalid"; engineVersion: string; inputHash: string; issues: ValidationIssue[]; points: [] };

/** Which failures can be injected into which component types. */
export interface FailureDefinition {
  kind: FailureKind;
  label: string;
  description: string;
  appliesTo: readonly ComponentType[];
  /** app-instance-failure takes a number of failed instances. */
  hasCount: boolean;
}
