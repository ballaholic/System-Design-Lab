import {
  type ArchitectureDocument,
  type ArchNode,
  type ComponentType,
  type ValidationIssue,
} from "@sdl/architecture";
import type { Failure, FailureDefinition, FailureKind, FailureScenario } from "./types";

/** Failure scenarios (PRD FAIL-1, ARCHITECTURE §6.4 "Failure scenario" column). */
export const FAILURES: Record<FailureKind, FailureDefinition> = {
  "database-primary-down": {
    kind: "database-primary-down",
    label: "Primary down",
    description:
      "The store stops serving reads and writes. Flows that call it fail; replicas don't take over.",
    appliesTo: ["sql-database", "nosql-database", "object-storage"],
    hasCount: false,
  },
  "cache-down": {
    kind: "cache-down",
    label: "Cache down",
    description: "Every lookup misses and every call to the cache fails, so reads fall through to the store.",
    appliesTo: ["redis-cache"],
    hasCount: false,
  },
  "app-instance-failure": {
    kind: "app-instance-failure",
    label: "Instances fail",
    description:
      "Some instances stop, reducing capacity. With no healthy instances left, distributors route around the server.",
    appliesTo: ["api-server"],
    hasCount: true,
  },
  "worker-down": {
    kind: "worker-down",
    label: "Worker down",
    description: "The worker consumes nothing. Publishing still succeeds and the backlog grows.",
    appliesTo: ["background-worker"],
    hasCount: false,
  },
};

export const FAILURE_KINDS = Object.keys(FAILURES) as FailureKind[];

export function failuresFor(type: ComponentType): FailureDefinition[] {
  return FAILURE_KINDS.map((k) => FAILURES[k]).filter((f) => f.appliesTo.includes(type));
}

/** Human-readable description of one failure, e.g. `"API server": 2 instances fail`. */
export function describeFailure(failure: Failure, node: ArchNode | undefined): string {
  const name = node ? `"${node.label}"` : "A removed component";
  return failure.kind === "app-instance-failure"
    ? `${name}: ${failure.count} instance${failure.count === 1 ? "" : "s"} failed`
    : `${name} is down`;
}

/**
 * Keeps the failures that apply to an existing component of the right type and merges duplicates
 * (instance failures on the same server add up). The rest are reported as warnings and ignored.
 */
export function normalizeScenario(
  doc: ArchitectureDocument,
  scenario: FailureScenario | undefined,
): { failures: Failure[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const failures: Failure[] = [];
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const failure of scenario?.failures ?? []) {
    const node = nodes.get(failure.nodeId);
    const def = FAILURES[failure.kind] as FailureDefinition | undefined;
    if (!def || !node || !def.appliesTo.includes(node.type)) {
      issues.push({
        code: "FAILURE_NOT_APPLICABLE",
        severity: "warning",
        message: node
          ? `"${def?.label ?? failure.kind}" can't be injected into "${node.label}", so it was ignored.`
          : "A failure targets a component that no longer exists, so it was ignored.",
        ...(node ? { nodeIds: [node.id] } : {}),
      });
      continue;
    }
    const existing = failures.find((f) => f.kind === failure.kind && f.nodeId === failure.nodeId);
    if (failure.kind === "app-instance-failure") {
      const count = Number.isFinite(failure.count) ? Math.max(1, Math.floor(failure.count)) : 1;
      if (existing?.kind === "app-instance-failure") existing.count += count;
      else failures.push({ kind: failure.kind, nodeId: failure.nodeId, count });
    } else if (!existing) {
      failures.push({ kind: failure.kind, nodeId: failure.nodeId });
    }
  }
  return { failures, issues };
}
