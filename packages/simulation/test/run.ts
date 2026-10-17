import type { ArchitectureDocument, TrafficProfile } from "@sdl/architecture";
import { type FailureScenario, simulate, type ValidSimulationResult } from "../src";

/** Simulates and fails the test if the result is invalid. */
export function run(
  doc: ArchitectureDocument,
  traffic: TrafficProfile,
  scenario?: FailureScenario,
): ValidSimulationResult {
  const result = simulate(doc, traffic, scenario);
  if (result.status !== "ok") {
    throw new Error(`Expected a valid simulation, got: ${result.issues.map((i) => i.code).join(", ")}`);
  }
  return result;
}
