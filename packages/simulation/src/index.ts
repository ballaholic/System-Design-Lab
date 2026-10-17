export { ASSUMPTION_IDS, ASSUMPTIONS, type Assumption, type AssumptionId } from "./assumptions";
export { ENGINE_VERSION, simulate, simulationInputHash, sweep } from "./engine";
export { describeFailure, FAILURE_KINDS, FAILURES, failuresFor, normalizeScenario } from "./failures";
export { canonicalJson, hash64 } from "./hash";
export {
  capabilitySummary,
  MENTOR_MAX_EVENTS,
  type MentorNode,
  type MentorSimulation,
  toMentorSimulation,
} from "./mentor";
export { TARGET_UTILIZATION, WARM_UTILIZATION } from "./results";
export {
  EVENT_DESCRIPTIONS,
  OUTCOME_DESCRIPTIONS,
  ROLE_SEMANTICS,
  type RoleSemantics,
  STATUS_DESCRIPTIONS,
} from "./semantics";
export type * from "./types";
