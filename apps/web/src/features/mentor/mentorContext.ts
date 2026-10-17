import type { ArchitectureDocument } from "@sdl/architecture";
import { simulate, toMentorSimulation, type FailureScenario } from "@sdl/simulation";
import type { MentorContext } from "@/lib/api/mentor";
import { trafficOf } from "../playground/simulation/simulationUi";

export interface ContextSummary {
  components: number;
  connections: number;
  /** Null when the design doesn't simulate yet; `problems` says why. */
  simulation: { engineVersion: string; totalRps: number; successRate: number; failures: number } | null;
  problems: number;
}

/**
 * The context sent with a message (PRD AI-2): the current, possibly unsaved, design and a fresh simulation of it
 * with the session's traffic and injected failures. Computed in the browser, like every simulation.
 */
export function buildMentorContext(
  doc: ArchitectureDocument,
  scenario: FailureScenario,
): { context: MentorContext; summary: ContextSummary } {
  const traffic = trafficOf(doc);
  const result = simulate(doc, traffic, scenario);
  const simulation = result.status === "ok" ? toMentorSimulation(result, traffic, scenario) : null;
  return {
    context: { architecture: doc, simulation },
    summary: {
      components: doc.nodes.length,
      connections: doc.edges.length,
      simulation: simulation && {
        engineVersion: simulation.engineVersion,
        totalRps: traffic.totalRps,
        successRate: simulation.summary.processingSuccessRate,
        failures: scenario.failures.length,
      },
      problems: result.issues.filter((i) => i.severity === "error").length,
    },
  };
}
