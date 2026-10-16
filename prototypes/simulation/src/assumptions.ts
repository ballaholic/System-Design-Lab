// Assumption registry (ARCHITECTURE §6.9). Rendered in docs and attached to every result.

export interface Assumption {
  id: string;
  text: string;
}

export const ASSUMPTIONS: readonly Assumption[] = [
  { id: "A-STEADY-STATE", text: "Rates are sustained averages; bursts, warm-up and transients are not modeled." },
  { id: "A-OVERLOAD-SHED", text: "Load above capacity is rejected immediately, not queued or retried." },
  { id: "A-INDEPENDENT-FAILURE", text: "Rejections at different components are independent and uniform across requests." },
  { id: "A-NO-SHORT-CIRCUIT", text: "All steps of a flow are attempted even if an earlier step failed; downstream load is an upper bound." },
  { id: "A-HEALTH-CHECKS", text: "Distributors stop routing to components that are fully down; degraded targets still get an even share." },
  { id: "A-EVEN-SPLIT", text: "Distribution is even across capable targets; queue consumption is proportional to consumer capacity." },
  { id: "A-HIT-RATE-GIVEN", text: "Cache hit rates are inputs, not derived from data size or TTL." },
  { id: "A-CACHE-ERROR-AS-MISS", text: "A rejected or failed cache lookup is treated as a miss and the request continues to the store." },
  { id: "A-POPULATE-BEST-EFFORT", text: "Cache populate writes after a miss use only capacity left over by lookups and calls." },
  { id: "A-NO-LATENCY", text: "Latency is not modeled; the engine reports throughput and success only." },
  { id: "A-ILLUSTRATIVE-CAPACITY", text: "Default capacities are illustrative orders of magnitude, not benchmarks." },
];
