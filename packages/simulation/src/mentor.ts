// What the AI mentor receives about the simulator (ARCHITECTURE §8.1, §8.3). The capability summary is generated
// from the same data as the "How the simulator works" page, and the simulation context is a compact copy of a
// valid result, so the mentor quotes engine numbers instead of inventing them.

import type { NodeId, OperationId, TrafficProfile } from "@sdl/architecture";
import { ASSUMPTIONS, type AssumptionId } from "./assumptions";
import { FAILURES } from "./failures";
import { ROLE_SEMANTICS } from "./semantics";
import type {
  Bottleneck,
  Failure,
  FailureScenario,
  NodeStatus,
  Resource,
  SimEvent,
  ValidSimulationResult,
} from "./types";

/** Upper bound on events sent to the mentor; the engine lists the most important first. */
export const MENTOR_MAX_EVENTS = 20;

export interface MentorNode {
  status: NodeStatus;
  /** Highest utilization over the node's resources; absent when it has no finite capacity. */
  utilization?: number;
  headroom?: number;
  effectiveHitRate?: number;
  backlogGrowthPerSec?: number;
  explanation: string[];
}

/** The simulation part of a mentor request. The API checks this exact shape (unknown fields are rejected). */
export interface MentorSimulation {
  engineVersion: string;
  inputHash: string;
  traffic: TrafficProfile;
  failures: Failure[];
  summary: {
    offered: number;
    processingSucceeded: number;
    processingSuccessRate: number;
    bottlenecks: Bottleneck[];
  };
  operations: Record<OperationId, { offered: number; processingSuccessRate: number }>;
  nodes: Record<NodeId, MentorNode>;
  capacity: {
    breakingPointRps: number | null;
    firstSaturation?: { nodeId: NodeId; resource: Resource };
    instancesNeeded: Record<NodeId, number>;
    targetUtilization: number;
  };
  events: SimEvent[];
  assumptions: AssumptionId[];
}

/** Four significant digits: enough for the mentor, and keeps the prompt small. */
const round = (value: number) => (Number.isFinite(value) ? Number(value.toPrecision(4)) : value);

export function toMentorSimulation(
  result: ValidSimulationResult,
  traffic: TrafficProfile,
  scenario: FailureScenario,
): MentorSimulation {
  const nodes: Record<NodeId, MentorNode> = {};
  for (const [id, node] of Object.entries(result.nodes)) {
    const utilizations =
      node.status === "down" ? [] : Object.values(node.resources).map((r) => r.utilization);
    nodes[id] = {
      status: node.status,
      ...(utilizations.length > 0 ? { utilization: round(Math.max(...utilizations)) } : {}),
      ...(node.headroom !== undefined ? { headroom: round(node.headroom) } : {}),
      ...(node.cache ? { effectiveHitRate: round(node.cache.effectiveHitRate) } : {}),
      ...(node.queue ? { backlogGrowthPerSec: round(node.queue.backlogGrowthPerSec) } : {}),
      explanation: node.explanation,
    };
  }
  return {
    engineVersion: result.engineVersion,
    inputHash: result.inputHash,
    traffic,
    failures: scenario.failures,
    summary: {
      offered: round(result.summary.offered),
      processingSucceeded: round(result.summary.processingSucceeded),
      processingSuccessRate: round(result.summary.processingSuccessRate),
      bottlenecks: result.summary.bottlenecks.map((b) => ({ ...b, utilization: round(b.utilization) })),
    },
    operations: Object.fromEntries(
      Object.entries(result.operations).map(([id, o]) => [
        id,
        { offered: round(o.offered), processingSuccessRate: round(o.processingSuccessRate) },
      ]),
    ),
    nodes,
    capacity: {
      breakingPointRps:
        result.capacity.breakingPointRps === null ? null : round(result.capacity.breakingPointRps),
      ...(result.capacity.firstSaturation ? { firstSaturation: result.capacity.firstSaturation } : {}),
      instancesNeeded: result.capacity.instancesNeeded,
      targetUtilization: result.capacity.targetUtilization,
    },
    events: result.events.slice(0, MENTOR_MAX_EVENTS),
    assumptions: result.assumptions,
  };
}

/**
 * What the simulator does and doesn't model, as Markdown for the mentor's system prompt. Generated from the
 * assumption registry, the component semantics and the failure catalog (ARCHITECTURE §6.9, §8.3).
 */
export function capabilitySummary(): string {
  const lines = [
    "# What the simulator models",
    "",
    "A deterministic, steady-state request-flow model. Each component has a capacity; traffic follows the connections and the flow steps defined on API servers and workers. Results are throughput and success rates per component and per operation.",
    "",
    "## Assumptions",
    "",
    ...ASSUMPTIONS.map((a) => `- ${a.id} (${a.title}): ${a.text}`),
    "",
    "## Components",
    "",
  ];
  for (const role of ROLE_SEMANTICS) {
    lines.push(
      `### ${role.title}`,
      "",
      `- Capacity: ${role.capacity}`,
      `- Behaviour: ${role.behaviour}`,
      `- Success: ${role.success}`,
      `- Not modeled: ${role.notModeled.join("; ")}.`,
      "",
    );
  }
  lines.push("## Failures that can be injected", "");
  for (const failure of Object.values(FAILURES)) {
    lines.push(`- ${failure.label} (${failure.appliesTo.join(", ")}): ${failure.description}`);
  }
  lines.push(
    "",
    "## Never modeled",
    "",
    "- Latency, percentiles and queueing delay.",
    "- Replication, failover, sharding, consistency and partitions.",
    "- Storage size, data transfer and cost.",
    "",
  );
  return lines.join("\n");
}
