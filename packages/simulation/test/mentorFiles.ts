import path from "node:path";
import { capabilitySummary, toMentorSimulation } from "../src";
import { run } from "./run";
import { STAGE2, urlShortenerWithCache } from "./scenarios";

// Generated files the API reads: the capability summary for the mentor's system prompt, and a sample simulation
// context that the API's tests deserialize to keep the C# contract in step with the TypeScript one.
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const CAPABILITIES_PATH = path.join(REPO_ROOT, "schemas/simulator-capabilities.md");
export const SAMPLE_CONTEXT_PATH = path.join(REPO_ROOT, "schemas/fixtures/mentor/simulation-context.json");

export function sampleScenario() {
  const doc = urlShortenerWithCache(4);
  const scenario = { failures: [{ kind: "database-primary-down" as const, nodeId: "db" }] };
  return { doc, scenario, result: run(doc, STAGE2, scenario) };
}

export const serializeCapabilities = () => capabilitySummary();

export function serializeSampleContext(): string {
  const { scenario, result } = sampleScenario();
  return `${JSON.stringify(toMentorSimulation(result, STAGE2, scenario), null, 2)}\n`;
}
