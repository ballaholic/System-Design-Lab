// Events, including honest "not modeled" notices (ARCHITECTURE §6.8).

import { flowsOf, type NodeId, walkSteps } from "@sdl/architecture";
import { fmt, pct } from "./format";
import type { Model } from "./model";
import type { Pass, SuccessModel } from "./pass";
import { opName } from "./results";
import type { NodeResult, SimEvent } from "./types";

const EPSILON = 1e-9;

export function detectEvents(
  model: Model,
  pass: Pass,
  nodes: Record<NodeId, NodeResult>,
  success: SuccessModel,
): SimEvent[] {
  const events: SimEvent[] = [];
  const { g } = model;
  const label = (id: NodeId) => `"${g.nodes.get(id)?.label ?? id}"`;
  const push = (kind: SimEvent["kind"], nodeIds: NodeId[], message: string) =>
    events.push({ kind, nodeIds, message });

  for (const node of model.doc.nodes) {
    const id = node.id;
    const r = nodes[id]!;
    const role = model.role.get(id);
    if (r.status === "down") push("down", [id], `${label(id)} is down.`);

    if (r.rateLimited !== undefined) {
      push(
        "rate-limited",
        [id],
        `${label(id)} rate-limits ${fmt(r.rateLimited)} requests/s (${pct(r.rateLimited / (r.resources.total?.offered ?? 1))} of its traffic).`,
      );
    } else {
      for (const [res, rr] of Object.entries(r.resources)) {
        if (!rr || rr.capacity === 0 || rr.utilization < 1 - EPSILON) continue;
        const what = res === "total" ? "" : ` (${res}s)`;
        push(
          "saturated",
          [id],
          role === "consumer"
            ? `${label(id)} can't keep up: it receives ${fmt(rr.offered)} messages/s and consumes ${fmt(rr.capacity)}.`
            : `${label(id)}${what} is saturated at ${pct(rr.utilization)} of capacity.`,
        );
      }
    }

    const q = r.queue;
    if (q && q.backlogGrowthPerSec > EPSILON) {
      push(
        "backlog-growing",
        [id],
        q.kind === "stream"
          ? `${label(id)} consumer lag grows by ${fmt(q.backlogGrowthPerSec)} messages/s.`
          : `${label(id)} backlog grows by ${fmt(q.backlogGrowthPerSec)} messages/s.`,
      );
      if (q.secondsToFull !== undefined) {
        push(
          "unmodeled",
          [id],
          `${label(id)} reaches its max depth in about ${duration(q.secondsToFull)}. What happens once it's full (rejected publishes, publisher errors) isn't modeled.`,
        );
      }
      if (q.kind === "stream") {
        push(
          "unmodeled",
          [id],
          `${label(id)} keeps messages only for its retention period. Losing unread messages when lag exceeds retention isn't modeled.`,
        );
      }
    }

    if (r.status === "idle" && role !== "source" && (g.incoming.get(id)?.length ?? 0) > 0) {
      push("idle", [id], `${label(id)} receives no traffic.`);
    }
  }

  for (const u of pass.unroutable) {
    push(
      "unroutable",
      [u.nodeId],
      `${fmt(u.rate)} requests/s of "${opName(model, u.op)}" at ${label(u.nodeId)} have no healthy component that handles them.`,
    );
  }
  for (const [brokerId, b] of pass.brokers) {
    if (b.unassigned > EPSILON) {
      push(
        "unroutable",
        [brokerId],
        `${fmt(b.unassigned)} messages/s in ${label(brokerId)} have no consumer with a flow for them.`,
      );
    }
  }

  for (const f of model.failures) {
    const failed = g.nodes.get(f.nodeId)!;
    if (f.kind === "database-primary-down") {
      // Another store of the same type used by the same callers could take over, but failover isn't modeled.
      const callers = new Set((g.incoming.get(f.nodeId) ?? []).map((e) => e.source));
      const siblings = new Set(
        model.doc.edges
          .filter(
            (e) =>
              callers.has(e.source) && e.target !== f.nodeId && g.nodes.get(e.target)?.type === failed.type,
          )
          .map((e) => e.target),
      );
      for (const s of siblings) {
        push(
          "unmodeled",
          [f.nodeId, s],
          `${label(s)} could take over from ${label(f.nodeId)}, but replication and failover aren't modeled. ${label(s)} receives only the traffic its flows send to it.`,
        );
      }
    } else if (f.kind === "cache-down") {
      push(
        "unmodeled",
        [f.nodeId],
        `When ${label(f.nodeId)} comes back it starts empty. The warm-up period and the burst of misses it causes aren't modeled.`,
      );
    } else if (f.kind === "app-instance-failure") {
      push(
        "unmodeled",
        [f.nodeId],
        `Replacing failed instances of ${label(f.nodeId)} (restarts, autoscaling) isn't modeled. Capacity stays reduced.`,
      );
    }
  }

  // Optional steps that fail: the request still succeeds, but retries and stale data aren't modeled.
  for (const node of model.doc.nodes) {
    if ((pass.admission.get(node.id)?.total ?? 0) === 0) continue;
    for (const [op, steps] of Object.entries(flowsOf(node))) {
      walkSteps(steps, (step) => {
        if (step.type === "cache-lookup" || !step.optional) return;
        const target = g.edges.get(step.edge)!.target;
        const p = success.steps([{ ...step, optional: false }], op);
        if (p < 1 - EPSILON) {
          push(
            "unmodeled",
            [node.id, target],
            `The optional ${step.type === "publish" ? "publish" : "call"} to ${label(target)} in "${opName(model, op)}" on ${label(node.id)} fails for ${pct(1 - p)} of requests. The request still succeeds; retries and stale data aren't modeled.`,
          );
        }
      });
    }
  }

  // A CDN serving write operations from its cache would need invalidation, which isn't modeled.
  for (const node of model.doc.nodes) {
    if (model.role.get(node.id) !== "edge-cache") continue;
    const writes = model.doc.operations.filter(
      (o) =>
        o.kind === "write" &&
        model.cacheable(node.id, o.id) &&
        (pass.inflow.get(node.id) ?? []).some((r) => r.op === o.id),
    );
    if (writes.length > 0) {
      push(
        "unmodeled",
        [node.id],
        `${label(node.id)} serves write operations (${writes.map((o) => `"${o.name}"`).join(", ")}) from its cache. Writes normally bypass a CDN; invalidation and stale responses aren't modeled.`,
      );
    }
  }

  return events;
}

function duration(seconds: number): string {
  if (seconds < 120) return `${fmt(seconds)} seconds`;
  if (seconds < 7200) return `${fmt(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${fmt(seconds / 3600)} hours`;
  return `${fmt(seconds / 86_400)} days`;
}
