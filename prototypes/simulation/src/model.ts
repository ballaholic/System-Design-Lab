// Architecture document and simulation types for the Phase 0 prototype.
// Mirrors docs/DATA_MODEL.md §1–2; trimmed to the components the prototype supports.

export type NodeId = string;
export type EdgeId = string;
export type OperationId = string;

export type OperationKind = "read" | "write";
export type Resource = "total" | "read" | "write";

export interface Operation {
  id: OperationId;
  name: string;
  kind: OperationKind;
  share: number;
}

export type FlowStep =
  | { type: "call"; edge: EdgeId; operation?: OperationId; as?: OperationKind; optional?: boolean }
  | { type: "cache-lookup"; edge: EdgeId; onMiss: FlowStep[]; populate?: boolean }
  | { type: "publish"; edge: EdgeId; message?: OperationId; optional?: boolean };

export type Flows = Record<OperationId, FlowStep[]>;

interface NodeBase {
  id: NodeId;
  label: string;
}

export type ArchNode =
  | (NodeBase & { type: "web-client" | "mobile-client"; config: { share?: number; operations?: OperationId[] } })
  | (NodeBase & { type: "load-balancer"; config: { capacityRps?: number } })
  | (NodeBase & { type: "api-server"; config: { instances?: number; capacityPerInstance?: number }; flows?: Flows })
  | (NodeBase & { type: "background-worker"; config: { instances?: number; throughputPerInstance?: number }; flows?: Flows })
  | (NodeBase & { type: "redis-cache"; config: { capacityOps?: number; hitRate?: number } })
  | (NodeBase & { type: "sql-database"; config: { readCapacity?: number; writeCapacity?: number } })
  | (NodeBase & { type: "message-queue"; config: { enqueueCapacity?: number; maxDepth?: number } });

export type ComponentType = ArchNode["type"];

export interface ArchEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
}

export interface ArchitectureDocument {
  schemaVersion: 1;
  operations: Operation[];
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export interface TrafficProfile {
  totalRps: number;
  /** Overrides Operation.share for this run. */
  mix?: Record<OperationId, number>;
}

export type Failure =
  | { kind: "database-primary-down"; nodeId: NodeId }
  | { kind: "cache-down"; nodeId: NodeId }
  | { kind: "app-instance-failure"; nodeId: NodeId; count: number }
  | { kind: "worker-down"; nodeId: NodeId };

export interface FailureScenario {
  failures: Failure[];
}

// ---------- results ----------

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  nodeIds?: NodeId[];
  edgeIds?: EdgeId[];
}

export interface ResourceResult {
  capacity: number;
  offered: number;
  admitted: number;
  rejected: number;
  utilization: number;
}

export type NodeStatus = "ok" | "warm" | "saturated" | "down" | "idle";

export interface NodeResult {
  status: NodeStatus;
  resources: Partial<Record<Resource, ResourceResult>>;
  byOperation: Record<OperationId, { offered: number; admitted: number }>;
  cache?: {
    lookups: number;
    hits: number;
    misses: number;
    effectiveHitRate: number;
    otherOps: number;
    populateOffered: number;
    populateAdmitted: number;
  };
  queue?: { inflow: number; accepted: number; consumed: number; backlogGrowthPerSec: number; secondsToFull?: number };
  explanation: string[];
}

export interface OperationOutcome {
  offered: number;
  accepted: number;
  processingSucceeded: number;
  processingSuccessRate: number;
  publications: Array<{ nodeId: NodeId; stepPath: string; queueId: NodeId; message: OperationId; attempted: number; published: number }>;
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

export type SimEventKind = "saturated" | "down" | "unroutable" | "backlog-growing" | "unmodeled";

export interface SimEvent {
  kind: SimEventKind;
  message: string;
  nodeIds: NodeId[];
}

export interface CapacityAnalysis {
  breakingPointRps: number | null;
  firstSaturation?: { nodeId: NodeId; resource: Resource };
  instancesNeeded: Record<NodeId, number>;
  targetUtilization: number;
}

export interface SimulationResult {
  engineVersion: string;
  status: "ok" | "invalid";
  issues: ValidationIssue[];
  nodes: Record<NodeId, NodeResult>;
  edges: Record<EdgeId, number>;
  operations: Record<OperationId, OperationOutcome>;
  deliveries: DeliveryOutcome[];
  summary: {
    offered: number;
    processingSucceeded: number;
    processingSuccessRate: number;
    bottlenecks: Array<{ nodeId: NodeId; resource: Resource; utilization: number }>;
  };
  capacity: CapacityAnalysis | null;
  events: SimEvent[];
  assumptions: string[];
}
