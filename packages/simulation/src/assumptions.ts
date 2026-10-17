// Assumptions registry (ARCHITECTURE §6.9). Every result lists these ids, and the "How the simulator works"
// page and the AI capability summary are generated from this data.

export type AssumptionId =
  | "A-STEADY-STATE"
  | "A-OVERLOAD-SHED"
  | "A-INDEPENDENT-FAILURE"
  | "A-NO-SHORT-CIRCUIT"
  | "A-HEALTH-CHECKS"
  | "A-EVEN-SPLIT"
  | "A-HIT-RATE-GIVEN"
  | "A-CACHE-ERROR-AS-MISS"
  | "A-POPULATE-BEST-EFFORT"
  | "A-NO-LATENCY"
  | "A-ILLUSTRATIVE-CAPACITY";

export interface Assumption {
  id: AssumptionId;
  title: string;
  text: string;
}

export const ASSUMPTIONS: readonly Assumption[] = [
  {
    id: "A-STEADY-STATE",
    title: "Steady state",
    text: "Rates are sustained averages. Bursts, warm-up and transients aren't modeled.",
  },
  {
    id: "A-OVERLOAD-SHED",
    title: "Overload is shed",
    text: "Load above capacity is rejected immediately, not queued or retried.",
  },
  {
    id: "A-INDEPENDENT-FAILURE",
    title: "Independent failures",
    text: "Rejections at different components are independent and spread uniformly across requests.",
  },
  {
    id: "A-NO-SHORT-CIRCUIT",
    title: "Every step is attempted",
    text: "All steps of a flow are attempted even if an earlier step failed, so downstream load is an upper bound.",
  },
  {
    id: "A-HEALTH-CHECKS",
    title: "Health checks",
    text: "Distributors stop routing to components that are fully down. Partially degraded targets still receive an even share.",
  },
  {
    id: "A-EVEN-SPLIT",
    title: "Even split",
    text: "Distribution is even across capable targets. Queue consumption is proportional to consumer capacity.",
  },
  {
    id: "A-HIT-RATE-GIVEN",
    title: "Hit rates are inputs",
    text: "Cache and CDN hit rates are chosen by you or the challenge, not derived from data size or TTL.",
  },
  {
    id: "A-CACHE-ERROR-AS-MISS",
    title: "Cache errors are misses",
    text: "A rejected or failed cache lookup is treated as a miss, and the request continues to the store.",
  },
  {
    id: "A-POPULATE-BEST-EFFORT",
    title: "Cache fills are best effort",
    text: "Cache populate writes after a miss use only capacity left over by lookups and calls.",
  },
  {
    id: "A-NO-LATENCY",
    title: "No latency",
    text: "Latency isn't modeled. The engine reports throughput and success only.",
  },
  {
    id: "A-ILLUSTRATIVE-CAPACITY",
    title: "Illustrative capacities",
    text: "Default capacities are illustrative orders of magnitude, not benchmarks.",
  },
];

export const ASSUMPTION_IDS: readonly AssumptionId[] = ASSUMPTIONS.map((a) => a.id);
