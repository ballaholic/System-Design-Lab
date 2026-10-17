// Turns a pass into per-node, per-operation and per-consumer results (ARCHITECTURE §6.3, §6.5 steps 6–7).

import type { EdgeId, NodeId, OperationId, TrafficProfile } from "@sdl/architecture";
import { fmt, pct } from "./format";
import type { Model } from "./model";
import { byOp, forwardPass, type Pass, sum, sumRate, type SuccessModel } from "./pass";
import type {
  Bottleneck,
  CapacityAnalysis,
  DeliveryOutcome,
  NodeResult,
  NodeStatus,
  OperationOutcome,
  Resource,
  ResourceResult,
} from "./types";

/** Utilization at which a component is "warm" and counts as a bottleneck candidate. */
export const WARM_UTILIZATION = 0.7;
/** Target utilization for "instances needed". */
export const TARGET_UTILIZATION = 0.7;
const EPSILON = 1e-9;

const RESOURCES: readonly Resource[] = ["total", "read", "write"];

export function nodeResults(model: Model, pass: Pass): Record<NodeId, NodeResult> {
  const out: Record<NodeId, NodeResult> = {};
  for (const n of model.doc.nodes) {
    const role = model.role.get(n.id)!;
    const config = model.config.get(n.id)!;
    const cap = model.capacity.get(n.id) ?? {};
    const offered = pass.offered.get(n.id) ?? {};
    const admission = pass.admission.get(n.id) ?? {};
    const recs = pass.inflow.get(n.id) ?? [];
    const cache = role === "cache" ? pass.cache.get(n.id) : undefined;
    const resources: NodeResult["resources"] = {};
    const explanation: string[] = [];
    const unit = unitOf(role);

    if (role === "source") {
      const ops = [...byOp(recs)].filter(([, rate]) => rate > 0);
      if (ops.length > 0) {
        explanation.push(
          `Sends ${fmt(sumRate(recs))} requests/s: ${ops.map(([op, rate]) => `${opName(model, op)} ${fmt(rate)}/s`).join(", ")}.`,
        );
      }
    }

    for (const res of RESOURCES) {
      const capacity = cap[res];
      if (capacity === undefined || !Number.isFinite(capacity)) continue;
      let off = offered[res] ?? 0;
      let admitted = off * (admission[res] ?? 0);
      if (cache) {
        off += cache.populateOffered;
        admitted += cache.populateAdmitted;
      }
      const utilization = capacity > 0 ? off / capacity : off > 0 ? Infinity : 0;
      const consumer = role === "consumer";
      resources[res] = {
        capacity,
        offered: off,
        admitted,
        rejected: consumer ? 0 : off - admitted,
        utilization,
      };
      const what = res === "total" ? unit : `${res}s/s`;
      if (consumer) {
        if (capacity === 0)
          explanation.push(`Down: ${fmt(off)} messages/s aren't consumed and stay in the backlog.`);
        else if (off > capacity + EPSILON)
          explanation.push(
            `Receives ${fmt(off)} messages/s but consumes only ${fmt(capacity)}. The rest stays in the backlog.`,
          );
        else if (off > 0)
          explanation.push(
            `Consumes ${fmt(off)} messages/s of ${fmt(capacity)} capacity (${pct(utilization)}).`,
          );
      } else if (capacity === 0) {
        if (off > 0) explanation.push(`Down: all ${fmt(off)} ${what} offered are rejected.`);
      } else if (off > capacity + EPSILON) {
        explanation.push(
          `Offered ${fmt(off)} ${what} vs capacity ${fmt(capacity)}, so ${pct(1 - capacity / off)} are rejected.`,
        );
      } else if (off > 0) {
        explanation.push(`Offered ${fmt(off)} ${what} of ${fmt(capacity)} capacity (${pct(utilization)}).`);
      }
    }

    const byOperation: NodeResult["byOperation"] = {};
    for (const r of recs) {
      const entry = (byOperation[r.op] ??= { offered: 0, admitted: 0 });
      entry.offered += r.rate;
      entry.admitted += r.rate * (role === "source" ? 1 : (admission[r.res] ?? 0));
    }

    const result: NodeResult = {
      status: statusOf(role === "source", cap, resources, recs),
      resources,
      byOperation,
      explanation,
    };

    const headrooms = Object.values(resources)
      .filter((r) => r.offered > 0)
      .map((r) => r.capacity / r.offered);
    if (headrooms.length > 0) result.headroom = Math.min(...headrooms);

    // Role-specific details.
    if (role === "distributor" && config.rateLimitRps !== undefined) {
      const limit = config.rateLimitRps as number;
      const off = offered.total ?? 0;
      if (limit < (config.capacityRps as number) && off > limit + EPSILON) {
        result.rateLimited = off - limit;
        explanation.push(`The rate limit of ${fmt(limit)} rps rejects ${fmt(off - limit)} requests/s.`);
      }
    }
    if (role === "service") {
      const failed = (config.instances as number) - (model.usableInstances.get(n.id) ?? 0);
      if (failed > 0) {
        explanation.push(
          `${fmt(failed)} of ${fmt(config.instances as number)} instances failed, leaving capacity ${fmt(cap.total ?? 0)} rps.`,
        );
      }
    }
    if (role === "consumer") {
      const usable = model.usableInstances.get(n.id) ?? 0;
      const configured = config.instances as number;
      if (usable > 0 && usable < configured) {
        explanation.push(
          `Only ${fmt(usable)} of ${fmt(configured)} instances can consume: the stream has ${fmt(usable)} partitions.`,
        );
      }
    }
    const stats = pass.cache.get(n.id);
    if (stats) {
      const hits = stats.lookups * stats.effectiveHitRate;
      result.cache = {
        lookups: stats.lookups,
        hits,
        misses: stats.lookups - hits,
        effectiveHitRate: stats.effectiveHitRate,
        otherOps: stats.otherOps,
        populateOffered: stats.populateOffered,
        populateAdmitted: stats.populateAdmitted,
      };
      if (role === "edge-cache") {
        if (stats.lookups > 0) {
          explanation.push(
            `Serves ${pct(stats.hitRate)} of cacheable requests at the edge (${fmt(hits)}/s) and forwards ${fmt(stats.lookups - hits + stats.otherOps)} requests/s.`,
          );
        } else if (stats.otherOps > 0) {
          explanation.push(`None of the requests it receives are cacheable, so it forwards all of them.`);
        }
      } else if (stats.lookups > 0) {
        explanation.push(
          stats.effectiveHitRate < stats.hitRate - EPSILON
            ? `Effective hit rate ${pct(stats.effectiveHitRate)} (configured ${pct(stats.hitRate)}): rejected lookups count as misses.`
            : `Hit rate ${pct(stats.hitRate)}: ${fmt(hits)} hits/s and ${fmt(stats.lookups - hits)} misses/s.`,
        );
      }
      if (stats.populateOffered > stats.populateAdmitted + EPSILON) {
        explanation.push(
          `${fmt(stats.populateOffered - stats.populateAdmitted)} of ${fmt(stats.populateOffered)} cache fills/s are dropped for lack of spare capacity.`,
        );
      }
    }

    const broker = pass.brokers.get(n.id);
    if (broker) {
      const mine = pass.deliveries.filter((d) => d.brokerId === n.id);
      const consumed = sum(mine.map((d) => consumedOf(pass, d.consumerId, d.inflow)));
      const owed =
        broker.kind === "stream" ? sum(mine.map((d) => d.inflow)) + broker.unassigned : broker.accepted;
      const growth = Math.max(0, owed - consumed);
      result.queue = {
        kind: broker.kind,
        inflow: broker.inflow,
        accepted: broker.accepted,
        consumed,
        backlogGrowthPerSec: growth,
        consumerGroups: broker.consumerGroups,
      };
      const maxDepth = config.maxDepth as number | undefined;
      if (broker.kind === "queue" && maxDepth !== undefined && growth > EPSILON) {
        result.queue.secondsToFull = maxDepth / growth;
      }
      if (broker.kind === "stream" && broker.consumerGroups > 1 && broker.accepted > 0) {
        explanation.push(
          `Each of the ${broker.consumerGroups} consumer groups receives all ${fmt(broker.accepted)} messages/s.`,
        );
      }
      if (growth > EPSILON) {
        explanation.push(
          broker.kind === "stream"
            ? `Consumer lag grows by ${fmt(growth)} messages/s in total.`
            : `Backlog grows by ${fmt(growth)} messages/s (consumers take ${fmt(consumed)} of ${fmt(broker.accepted)}).`,
        );
      }
    }

    out[n.id] = result;
  }
  return out;
}

function statusOf(
  isSource: boolean,
  cap: Partial<Record<Resource, number>>,
  resources: NodeResult["resources"],
  recs: readonly { rate: number }[],
): NodeStatus {
  const offered = recs.reduce((a, r) => a + r.rate, 0);
  if (isSource) return offered > 0 ? "ok" : "idle";
  const caps = Object.values(cap);
  if (caps.length > 0 && caps.every((c) => c === 0)) return "down";
  const max = Math.max(0, ...Object.values(resources).map((r) => r.utilization));
  if (offered === 0 || max === 0) return "idle";
  if (max >= 1 - EPSILON) return "saturated";
  if (max >= WARM_UTILIZATION) return "warm";
  return "ok";
}

export function consumedOf(pass: Pass, consumerId: NodeId, inflow: number): number {
  return inflow * (pass.admission.get(consumerId)?.total ?? 0);
}

export function operationOutcomes(
  model: Model,
  pass: Pass,
  success: SuccessModel,
): Record<OperationId, OperationOutcome> {
  const out: Record<OperationId, OperationOutcome> = {};
  const clients = model.doc.nodes.filter((n) => model.role.get(n.id) === "source");
  for (const op of model.doc.operations) {
    let offered = 0;
    let accepted = 0;
    let succeeded = 0;
    for (const c of clients) {
      const rate = sumRate((pass.inflow.get(c.id) ?? []).filter((r) => r.op === op.id));
      if (rate === 0) continue;
      offered += rate;
      const targets = model.routableTargets(c.id, op.id);
      for (const e of targets)
        accepted += (rate / targets.length) * (pass.admission.get(e.target)?.total ?? 0);
      succeeded += rate * success.node(c.id, op.id, "total");
    }
    out[op.id] = {
      offered,
      accepted,
      processingSucceeded: succeeded,
      processingSuccessRate: offered > 0 ? succeeded / offered : 1,
      publications: pass.publications
        .filter((p) => p.operation === op.id)
        .map((p) => ({ ...p, published: p.attempted * (pass.admission.get(p.brokerId)?.total ?? 0) })),
    };
  }
  return out;
}

export function deliveryOutcomes(pass: Pass, success: SuccessModel): DeliveryOutcome[] {
  return pass.deliveries.map((d) => {
    const consumed = consumedOf(pass, d.consumerId, d.inflow);
    return {
      brokerId: d.brokerId,
      consumerId: d.consumerId,
      message: d.message,
      inflow: d.inflow,
      consumed,
      backlogGrowthPerSec: d.inflow - consumed,
      consumerSuccessRate: consumed > 0 ? success.node(d.consumerId, d.message, "total") : null,
    };
  });
}

export function edgeResults(model: Model, pass: Pass): Record<EdgeId, number> {
  return Object.fromEntries(model.doc.edges.map((e) => [e.id, pass.edgeFlow.get(e.id) ?? 0]));
}

export function bottlenecks(nodes: Record<NodeId, NodeResult>): Bottleneck[] {
  const list: Bottleneck[] = [];
  for (const [nodeId, r] of Object.entries(nodes)) {
    for (const res of RESOURCES) {
      const rr: ResourceResult | undefined = r.resources[res];
      if (rr && rr.capacity > 0 && rr.utilization >= WARM_UTILIZATION) {
        list.push({ nodeId, resource: res, utilization: rr.utilization });
      }
    }
  }
  return list.sort((x, y) => y.utilization - x.utilization || x.nodeId.localeCompare(y.nodeId));
}

/** Demand for each node and resource at a given traffic, with every healthy component admitting everything. */
export function demandPass(model: Model, traffic: TrafficProfile): Pass {
  return forwardPass(model, traffic, "uncapped");
}

/**
 * Exact below saturation (ARCHITECTURE §6.7): loads scale linearly with total RPS, so the breaking point is
 * totalRps × min(capacity / demand). Cache fills are excluded because they are best effort.
 */
export function capacityAnalysis(model: Model, traffic: TrafficProfile, demand: Pass): CapacityAnalysis {
  let best: { ratio: number; nodeId: NodeId; resource: Resource } | null = null;
  const instancesNeeded: Record<NodeId, number> = {};

  for (const id of model.order) {
    const cap = model.capacity.get(id) ?? {};
    const load = demand.offered.get(id) ?? {};
    for (const res of RESOURCES) {
      const c = cap[res];
      const l = load[res] ?? 0;
      if (c === undefined || c === 0 || !Number.isFinite(c) || l === 0) continue;
      const ratio = c / l;
      if (!best || ratio < best.ratio - EPSILON) best = { ratio, nodeId: id, resource: res };
    }
    const role = model.role.get(id);
    if (role === "service" || role === "consumer") {
      const config = model.config.get(id)!;
      const per = (
        role === "service" ? config.capacityPerInstanceRps : config.throughputPerInstance
      ) as number;
      instancesNeeded[id] = Math.ceil((load.total ?? 0) / (per * TARGET_UTILIZATION) - EPSILON);
    }
  }
  return {
    breakingPointRps: best ? traffic.totalRps * best.ratio : null,
    ...(best ? { firstSaturation: { nodeId: best.nodeId, resource: best.resource } } : {}),
    instancesNeeded,
    targetUtilization: TARGET_UTILIZATION,
  };
}

export function opName(model: Model, op: OperationId): string {
  return model.doc.operations.find((o) => o.id === op)?.name ?? op;
}

function unitOf(role: string): string {
  switch (role) {
    case "cache":
      return "ops/s";
    case "queue":
    case "stream":
    case "consumer":
      return "messages/s";
    default:
      return "requests/s";
  }
}
