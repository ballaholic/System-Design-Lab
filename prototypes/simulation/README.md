# Experiment A — Request-flow simulation prototype

Phase 0 prototype of the engine specified in [ARCHITECTURE §6](../../docs/ARCHITECTURE.md#6-simulation-engine--request-flow-model).
It's not production code. Phase 3 promotes it into `packages/simulation`, and these tests become the
regression baseline.

```bash
npm install
npm test          # 30 Vitest tests
npm run typecheck
npm run report    # prints the URL Shortener stage lessons
```

## Scope

| Included | Deferred to Phase 3 (specified, low risk) |
|---|---|
| Web/mobile client, load balancer, API server, background worker, Redis, SQL database, message queue | API gateway, CDN, event stream, NoSQL, object storage |
| Operations, flows, `call` / `cache-lookup` (+`populate`) / `publish` steps | Zod schema and JSON Schema export |
| Admission and shedding, the four outcome categories, failure scenarios, capacity analysis, events, explanations | Sweep, input hash, richer `unmodeled` detection |

## Results (URL Shortener, 11,000 rps at 10:1)

| Scenario | redirect success | create success | Key observation |
|---|---|---|---|
| Stage 1, 110 rps, no cache | 100% | 100% | Everything idle. Breaking point 2,000 rps (2 API instances). |
| Stage 2, no cache, 16 API instances | **50%** | 100% | PostgreSQL reads at 200% of capacity. Writes at 50%. Breaking point 5,500 rps (DB reads). |
| Stage 2, Redis cache-aside at 80% hits | 100% | 100% | DB reads drop to 2,000/s (40%). Redis takes 10k lookups + 2k populates + 1k invalidations. Breaking point 16,000 rps (API). |
| Stage 3, primary DB down | **80%** (= hit rate) | **0%** | Creates are still *accepted* (1,000/s) but fail during processing. |
| Stage 3, with an unused replica connected | 80% | 0% | `unmodeled` event: replication and failover aren't modeled. Warning: the replica connection carries no traffic. |
| Cache down | 50% | 100% | All reads fall through to the DB. The failing optional invalidation is reported as `unmodeled` (retries and stale data). |
| Async, worker down, 1,000 rps | — | 100%, published 1,000/s | Delivered 0. Backlog +1,000 msg/s. Queue full in ~1,000 s, and behaviour after that is `unmodeled`. 8 workers needed at 70%. |

## What the experiment validated

1. **The request-flow model is sufficient and small.** Three step types plus capability-aware distribution express every MVP lesson: the cache-aside read path, the write path with invalidation, operation-specific routing to different services, async publish/consume, and failure blast radius.
2. **Determinism and exactness.** One topological forward pass plus a memoised success recursion. No iteration or fixed points. The breaking point is exact because loads are linear below saturation.
3. **The four outcomes stay distinct:** accepted (entry admission), processing success, publication, and delivery (with backlog, not failure, for unconsumed messages).
4. **Honest limits.** Replica failover, behaviour after a queue fills, and retries of optional steps produce `unmodeled` events instead of numbers.

## Design details settled during the experiment (now in ARCHITECTURE §6)

- **Cache populate is best-effort** and uses only the capacity left after lookups and calls (A-POPULATE-BEST-EFFORT). Otherwise populate load would feed back into the cache's own admission and require a fixed-point solve.
- **On-miss steps may not call the cache being looked up** (validation error `LOOKUP_SELF`). Use `populate` instead. This keeps the evaluation graph acyclic.
- **`share: 0`** marks an internal or message-only operation (e.g. `notify`) that clients never send.
- **Consumers never reject.** When every consumer is down, messages are still attributed to them (even split), so delivery shows `0 of N consumed` and capacity analysis still reports the instances needed.
- `consumerSuccessRate` is `null` when nothing is consumed, rather than a vacuous 100%.
- The cache's reported utilization includes populate attempts. Under A-NO-SHORT-CIRCUIT, a down cache shows lookups, invalidations, and attempted populates as offered load.

## Open questions for Phase 3

- **Flow-authoring UX** remains the main product risk (not an engine risk). See ARCHITECTURE §11.
- Should optional steps' failures appear in a per-operation "degraded" metric? Today they appear as events only.
