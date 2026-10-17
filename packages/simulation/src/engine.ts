// Deterministic steady-state request-flow engine (ARCHITECTURE §6).
// Pure: no I/O, no randomness, no clock. Same input, deep-equal output.

import type { ArchitectureDocument, TrafficProfile, ValidationIssue } from "@sdl/architecture";
import { LIMITS } from "@sdl/architecture";
import { ASSUMPTION_IDS } from "./assumptions";
import { detectEvents } from "./events";
import { canonicalJson, hash64 } from "./hash";
import { type Model, prepare } from "./model";
import { forwardPass, operationRates, sum, successModel } from "./pass";
import {
  bottlenecks,
  capacityAnalysis,
  deliveryOutcomes,
  demandPass,
  edgeResults,
  nodeResults,
  operationOutcomes,
} from "./results";
import type {
  FailureScenario,
  Resource,
  SimulationResult,
  SweepOptions,
  SweepPoint,
  SweepResult,
} from "./types";

export const ENGINE_VERSION = "1.0.0";

const DEFAULT_SWEEP_POINTS = 50;
const MAX_SWEEP_POINTS = 200;

export function simulate(
  doc: ArchitectureDocument,
  traffic: TrafficProfile,
  scenario: FailureScenario = { failures: [] },
): SimulationResult {
  const inputHash = simulationInputHash(doc, traffic, scenario);
  const base = { engineVersion: ENGINE_VERSION, inputHash, assumptions: [...ASSUMPTION_IDS] };
  const trafficIssues = checkTraffic(traffic);
  const prepared = prepare(doc, scenario);
  const issues = [...prepared.issues, ...trafficIssues];
  if (!prepared.ok || trafficIssues.length > 0) return { ...base, status: "invalid", issues };

  const { model } = prepared;
  const pass = forwardPass(model, traffic, "capped");
  const success = successModel(model, pass);
  const nodes = nodeResults(model, pass);
  const operations = operationOutcomes(model, pass, success);
  const offered = sum(Object.values(operations).map((o) => o.offered));
  const succeeded = sum(Object.values(operations).map((o) => o.processingSucceeded));

  return {
    ...base,
    status: "ok",
    issues,
    nodes,
    edges: edgeResults(model, pass),
    operations,
    deliveries: deliveryOutcomes(pass, success),
    summary: {
      offered,
      processingSucceeded: succeeded,
      processingSuccessRate: offered > 0 ? succeeded / offered : 1,
      bottlenecks: bottlenecks(nodes),
    },
    capacity: capacityAnalysis(model, traffic, demandPass(model, traffic)),
    events: detectEvents(model, pass, nodes, success),
  };
}

/**
 * Success rate across a range of RPS values (SIM-5), from the same engine. The document is validated and
 * prepared once; each point is one forward pass plus the success model.
 */
export function sweep(
  doc: ArchitectureDocument,
  traffic: TrafficProfile,
  scenario: FailureScenario = { failures: [] },
  options: SweepOptions = {},
): SweepResult {
  const inputHash = simulationInputHash(doc, traffic, scenario);
  const trafficIssues = checkTraffic(traffic);
  const prepared = prepare(doc, scenario);
  const issues = [...prepared.issues, ...trafficIssues];
  if (!prepared.ok || trafficIssues.length > 0) {
    return { status: "invalid", engineVersion: ENGINE_VERSION, inputHash, issues, points: [] };
  }
  const { model } = prepared;
  const breakingPointRps = capacityAnalysis(model, traffic, demandPass(model, traffic)).breakingPointRps;
  const count = Math.min(MAX_SWEEP_POINTS, Math.max(2, Math.floor(options.points ?? DEFAULT_SWEEP_POINTS)));
  const max = Math.min(
    LIMITS.maxTotalRps,
    options.maxRps !== undefined && options.maxRps > 0
      ? options.maxRps
      : 2 * (breakingPointRps ?? traffic.totalRps),
  );

  const points: SweepPoint[] = [];
  for (let i = 1; i <= count; i++) {
    const rps = (max * i) / count;
    points.push(sweepPoint(model, { ...traffic, totalRps: rps }));
  }
  return { status: "ok", engineVersion: ENGINE_VERSION, inputHash, issues, breakingPointRps, points };
}

function sweepPoint(model: Model, traffic: TrafficProfile): SweepPoint {
  const pass = forwardPass(model, traffic, "capped");
  const success = successModel(model, pass);
  const operations: Record<string, number> = {};
  let offered = 0;
  let succeeded = 0;
  const clients = model.doc.nodes.filter((n) => model.role.get(n.id) === "source");
  const rates = operationRates(model, traffic);
  for (const op of model.doc.operations) {
    let opOffered = 0;
    let opSucceeded = 0;
    for (const c of clients) {
      const rate = (pass.inflow.get(c.id) ?? []).reduce((a, r) => (r.op === op.id ? a + r.rate : a), 0);
      opOffered += rate;
      opSucceeded += rate * success.node(c.id, op.id, "total");
    }
    if ((rates.get(op.id) ?? 0) > 0) operations[op.id] = opOffered > 0 ? opSucceeded / opOffered : 1;
    offered += opOffered;
    succeeded += opSucceeded;
  }

  let worst: { nodeId: string; resource: Resource; utilization: number } | null = null;
  for (const [nodeId, offeredByRes] of pass.offered) {
    const cap = model.capacity.get(nodeId) ?? {};
    for (const [res, off] of Object.entries(offeredByRes) as Array<[Resource, number]>) {
      const c = cap[res];
      if (c === undefined || c === 0 || !Number.isFinite(c)) continue;
      const utilization = off / c;
      if (utilization >= 1 - 1e-9 && (!worst || utilization > worst.utilization)) {
        worst = { nodeId, resource: res, utilization };
      }
    }
  }
  return {
    rps: traffic.totalRps,
    processingSuccessRate: offered > 0 ? succeeded / offered : 1,
    operations,
    ...(worst ? { firstSaturated: { nodeId: worst.nodeId, resource: worst.resource } } : {}),
  };
}

/** Hash of everything that affects a result: the document without layout, connection sides and notes, traffic and scenario. */
export function simulationInputHash(
  doc: ArchitectureDocument,
  traffic: TrafficProfile,
  scenario: FailureScenario = { failures: [] },
): string {
  const { layout: _layout, edgeLayout: _sides, notes: _notes, traffic: _saved, ...model } = doc;
  return hash64(canonicalJson({ engine: ENGINE_VERSION, model, traffic, scenario }));
}

function checkTraffic(traffic: TrafficProfile): ValidationIssue[] {
  const ok =
    Number.isFinite(traffic.totalRps) && traffic.totalRps > 0 && traffic.totalRps <= LIMITS.maxTotalRps;
  const mixOk = Object.values(traffic.mix ?? {}).every((v) => Number.isFinite(v) && v >= 0);
  const issues: ValidationIssue[] = [];
  if (!ok) {
    issues.push({
      code: "TRAFFIC_INVALID",
      severity: "error",
      message: `Total traffic must be more than 0 and at most ${LIMITS.maxTotalRps.toLocaleString("en-US")} requests per second.`,
    });
  }
  if (!mixOk) {
    issues.push({
      code: "TRAFFIC_INVALID",
      severity: "error",
      message: "Operation shares can't be negative.",
    });
  }
  return issues;
}
