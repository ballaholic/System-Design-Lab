# System Design Lab — Technical Architecture

Status: **Approved with revisions (2026-10-16)**. §6 was redesigned around an explicit request-flow model.

Decisions referenced as `ADR-xxx` are recorded in [DECISIONS.md](DECISIONS.md). Entities are in
[DATA_MODEL.md](DATA_MODEL.md).

---

## 1. System overview

```
                         ┌──────────────────────────────────────────────┐
                         │                Browser (SPA)                 │
                         │                                              │
                         │  apps/web (React, Vite, Tailwind, shadcn)    │
                         │   ├─ Playground (React Flow = view only)     │
                         │   ├─ Editor store (Zustand) ─┐               │
                         │   │                          ▼               │
                         │   │   @sdl/architecture  (model, catalog,    │
                         │   │                       validation)        │
                         │   │   @sdl/simulation    (engine, pure TS)   │
                         │   │   @sdl/challenges    (criteria eval)     │
                         │   ├─ Server state (TanStack Query)           │
                         │   └─ supabase-js  (auth only)                │
                         └───────┬───────────────────────┬──────────────┘
                     auth flows  │                       │  REST + SSE, Bearer JWT
                                 ▼                       ▼
                    ┌────────────────────┐   ┌───────────────────────────────┐
                    │   Supabase Auth    │   │   ASP.NET Core API (monolith) │
                    │  (hosted; OAuth,   │   │   Features/                   │
                    │   email, JWKS)     │   │    Users  Architectures       │
                    └─────────┬──────────┘   │    Challenges  Progress       │
                              │ JWKS (cached)│    Mentor (Claude)            │
                              └─────────────►│   EF Core ─┐   Anthropic SDK ─┼──► Claude API
                                             └────────────┼──────────────────┘
                                                          ▼
                                             ┌──────────────────────────┐
                                             │ PostgreSQL (Supabase)    │
                                             │  schema `auth` (Supabase)│
                                             │  schema `app`  (EF Core) │
                                             └──────────────────────────┘
```

Key properties:

- **Modular monolith.** One API process and one database. No message brokers or caches in our own
  infrastructure. The Redis and Kafka in the playground are *simulated nodes* only (ADR-001).
- **Domain logic in pure TypeScript packages.** The architecture model, validation, simulation, and
  challenge criteria evaluation have no dependencies on React, React Flow, or the network
  (ADR-003, ADR-005).
- **One data path.** The frontend uses Supabase **only for auth**. All application data goes through
  the ASP.NET API, which is the single enforcement point for ownership, validation, and quotas (ADR-006).
- **The backend is the only holder of secrets** (Anthropic API key, DB credentials, Supabase secret key).

## 2. Repository structure

pnpm workspace for TypeScript, a .NET solution for the backend, and content kept separate from code (ADR-002).

```
system-design-lab/
├─ apps/
│  └─ web/                         # React SPA
│     ├─ src/
│     │  ├─ app/                   # router, providers, layouts, error boundaries
│     │  ├─ features/
│     │  │  ├─ auth/               # login/register/reset pages, session hooks
│     │  │  ├─ dashboard/
│     │  │  ├─ playground/
│     │  │  │  ├─ canvas/          # React Flow adapter: model ⇄ RF nodes/edges
│     │  │  │  ├─ library/         # component palette
│     │  │  │  ├─ inspector/       # schema-driven property forms
│     │  │  │  ├─ flows/           # operation list + per-service flow editor
│     │  │  │  ├─ simulation/      # traffic panel, overlays, metrics, sweep chart
│     │  │  │  ├─ store/           # Zustand editor store + history
│     │  │  │  └─ persistence/     # autosave, local drafts, guest import
│     │  │  ├─ challenges/
│     │  │  ├─ mentor/             # chat UI, SSE client, findings cards
│     │  │  └─ profile/
│     │  ├─ components/ui/         # shadcn components (owned code)
│     │  ├─ lib/                   # api client, problem-details mapping, utils
│     │  └─ styles/                # Tailwind theme tokens
│     └─ e2e/                      # Playwright
├─ packages/
│  ├─ architecture/                # @sdl/architecture — schema (Zod), catalog, validation, migrations
│  ├─ simulation/                  # @sdl/simulation   — engine, scenarios, sweep; depends on architecture
│  ├─ challenges/                  # @sdl/challenges   — challenge schema + criteria evaluator
│  └─ config/                      # shared tsconfig / eslint presets
├─ content/
│  └─ challenges/
│     ├─ url-shortener/
│     │  ├─ challenge.json         # validated against @sdl/challenges schema
│     │  ├─ starter.json           # optional starter ArchitectureDocument
│     │  └─ *.md                   # explanations, hints (original writing)
│     ├─ notification-system/
│     └─ search-autocomplete/
├─ schemas/                        # GENERATED, committed: JSON Schemas exported from Zod
│  ├─ architecture.schema.json     #   consumed by the .NET API for boundary validation
│  ├─ challenge.schema.json
│  └─ fixtures/                    # versioned sample documents for compatibility tests (ADR-022)
├─ prototypes/                     # Phase 0 experiments (not production code)
│  ├─ simulation/                  #   request-flow engine prototype + tests
│  └─ auth-spike/                  #   ASP.NET + Supabase token validation spike
├─ server/
│  ├─ SystemDesignLab.sln
│  ├─ src/SystemDesignLab.Api/
│  │  ├─ Features/
│  │  │  ├─ Users/                 # /me, profile, account deletion, lazy provisioning
│  │  │  ├─ Architectures/         # CRUD, duplicate, snapshots, guest import
│  │  │  ├─ Challenges/            # serves content catalog (anonymous)
│  │  │  ├─ Progress/              # attempts, stage results
│  │  │  └─ Mentor/                # conversations, prompt building, Claude client, budgets
│  │  ├─ Infrastructure/           # DbContext, migrations, auth setup, JSON schema validator
│  │  ├─ Common/                   # ProblemDetails, current-user accessor, pagination
│  │  └─ Program.cs
│  └─ tests/SystemDesignLab.Api.Tests/   # integration tests (WebApplicationFactory + Testcontainers)
├─ supabase/                       # optional Supabase CLI config (only if local Supabase is adopted)
├─ docs/
└─ .github/workflows/ci.yml
```

**Why one .NET project and not Clean Architecture's four.** Most backend logic is CRUD plus ownership
plus a Claude proxy. Domain rules live in TypeScript. Feature folders give the modular boundaries
(ADR-016).

## 3. Module responsibilities and boundaries

| Module | Owns | Must not |
|---|---|---|
| `@sdl/architecture` | `ArchitectureDocument` types and Zod schema, component catalog, operations and flow-step schema, graph and flow validation, document schema migrations, JSON Schema export | Import React, React Flow, or simulation code. Do I/O. |
| `@sdl/simulation` | Engine (`simulate(doc, traffic, scenario) → SimulationResult`), per-component semantics, failure scenarios, capacity analysis, sweep, assumption registry | Depend on UI. Use randomness, time, or I/O. Infer flows the user didn't define. |
| `@sdl/challenges` | Challenge definition schema, criteria evaluator | Know about persistence or UI. |
| `apps/web` — canvas adapter | Mapping model ⇄ React Flow nodes/edges, rendering, gestures | Hold domain state that isn't in the store. |
| `apps/web` — flow editor | Editing operations and per-service flows. Offers **suggested** flows when connections are drawn (editor convenience; the user sees and can change them). | Hide suggestions. The engine never guesses. |
| `apps/web` — editor store | Current document, selection, history, dirty state, simulation inputs/results. Cascades flow-step cleanup when edges are deleted. | Make network calls directly. |
| API `Users` | Profile provisioning, profile update, account deletion | Issue tokens or store passwords. |
| API `Architectures` | Owner-scoped CRUD, optimistic concurrency, snapshots, idempotent guest import, schema validation | Interpret simulation semantics. |
| API `Challenges` | Load and validate content at startup, serve it anonymously | Store challenge definitions in the DB. |
| API `Progress` | Attempts, stage results, hints, completion | Re-run simulations (ADR-010). |
| API `Mentor` | Conversations, prompt assembly, Claude calls, rate limits, cost budgets, usage accounting | Accept client-supplied system prompts or models. |

## 4. Shared architecture model across TypeScript and C#

The model is canonical in **TypeScript (Zod)** (ADR-003).

- `@sdl/architecture` exports the Zod schema. A build script writes `schemas/architecture.schema.json`.
  CI fails if the committed schema is stale.
- The **.NET API validates incoming documents against the committed JSON Schema** (JsonSchema.Net),
  enforces size limits, and stores `jsonb`. C# has only a thin read model.
- **Schema versioning and compatibility (ADR-022):** each document carries `schemaVersion`.
  - `schemas/fixtures/v{N}/*.json` holds representative documents for every released version.
  - TS tests: every fixture of every version migrates to the current version and passes the current schema. Migrations are pure functions `vN → vN+1`.
  - .NET tests: current-version fixtures pass the JSON Schema, and known-invalid fixtures fail it, which proves the TS and .NET validators agree.
  - The server accepts only the current `schemaVersion` on write. Clients migrate on load. A schema change that alters structure must add a migration, a new fixture directory, and a version bump. CI enforces that the fixture directory for the current version exists.

## 5. Frontend architecture

### 5.1 Stack (pin exact versions at scaffold time)

React 19, TypeScript (strict), Vite, Tailwind CSS v4, shadcn/ui, **@xyflow/react v12**, Zustand,
TanStack Query, React Router, Zod, react-hook-form, Recharts, Vitest, Testing Library, Playwright.

### 5.2 Editor state and React Flow

```
            user gesture                        render
React Flow ─────────────► editor store ─────► selectors ─────► React Flow (controlled)
  (view)    onNodesChange   (Zustand)          toRFNodes(doc, layout, simResult, selection)
            onConnect         │
            onNodeDragStop    ├─ document: ArchitectureDocument   ◄── source of truth
                              ├─ layout:   Record<nodeId, {x,y}>  (inside document, separate from graph)
                              ├─ history:  past[] / future[]
                              ├─ selection, viewport (not in history)
                              └─ simulation: inputs, latest result
```

- React Flow runs controlled. A drag commits one history entry on drag stop.
- Undo/redo uses snapshots of the document (ADR-014): capped at 100, with text edits coalesced.
- `isValidConnection` delegates to catalog connection rules.
- Deleting an edge removes flow steps that reference it as part of the **same history entry**. The UI
  warns before deleting an edge that flows use.
- Simulation overlays are derived in selectors and never written into the document.

### 5.3 Persistence and guest mode

- **Guest:** designs (up to 10) and guest challenge progress autosave to `localStorage` through a
  try/catch storage adapter.
- **Signed-in:** debounced autosave (2 s) with `If-Match`. A local draft is kept until the server acknowledges the save.
- **Guest import after login:** designs **and** guest challenge attempts are posted to the import
  endpoint with local UUIDs as idempotency keys.

### 5.4 Routing

`/` · `/playground/:designId?` · `/challenges` · `/challenges/:slug` · `/challenges/:slug/attempt/:attemptId?` ·
`/login` · `/register` · `/auth/callback` · `/reset-password` · `/profile` · `/designs` · `/docs/simulator`.

### 5.5 Design system

Dark-first CSS-variable tokens mapped into Tailwind v4 `@theme`, with a light override. One accent colour.
Semantic status colours are always paired with icon and text. Inter or Geist for UI, JetBrains Mono for
metrics. 4 px spacing scale. shadcn components restyled to tokens.

## 6. Simulation engine — request-flow model

This section is the normative specification of simulator semantics (ADR-005, ADR-021). The engine
implements exactly what's written here. Anything not listed is **not modeled**, and the engine says
so instead of producing a number.

### 6.1 Model type

- **Deterministic steady state.** For a given (document, traffic profile, failure scenario) the engine computes sustained rates. There's no clock and no randomness, so identical inputs give deep-equal outputs.
- Units: requests per second (rps) for synchronous work, messages per second for asynchronous work.
- The engine is linear below saturation. Saturation introduces the only non-linearity, `min(1, capacity/offered)`.

### 6.2 Core concepts

**Operation.** A named kind of user request, defined once per document:

```ts
{ id: "redirect", name: "Follow short link", kind: "read", share: 10 }
{ id: "create",   name: "Create short link", kind: "write", share: 1 }
```

The traffic profile is `totalRps` plus the operation mix (`share` values, normalised). The derived
read/write ratio is shown in the UI. It's an output of the mix, not a separate input. `share: 0` marks
an internal or message-only operation (e.g. `notify`, handled only by consumers) that clients never send.

**Connection (edge).** A directed link between two nodes. **Edges have no traffic semantics of their own.**
An edge carries traffic only if a distributor routes over it or a flow step references it. Unused edges
produce a warning ("this connection carries no traffic").

**Flow.** Defined on *service* nodes (API server, background worker): `flows[operationId] = Step[]`.
A flow is the ordered list of things that node does to handle that operation. A service without a flow
for an operation **cannot handle** it, and distributors won't route that operation to it.

**Steps.** There are three kinds, and that's the whole language. No loops, arbitrary conditions,
retries, timeouts, or variables.

| Step | Shape | Meaning |
|---|---|---|
| `call` | `{ type: "call", edge, operation?, as?, optional? }` | **Sequential** synchronous call over `edge`. `operation` overrides which operation the target sees (default: the same one). `as: "read" \| "write"` sets which store capacity is used (default: the operation's kind). `optional: true` means failure doesn't fail the request (best-effort, e.g. cache invalidation). |
| `cache-lookup` | `{ type: "cache-lookup", edge, onMiss: Step[], populate? }` | **Conditional.** Look up in the cache behind `edge`. Hits finish this step. Misses execute `onMiss` steps. `populate: true` adds a best-effort cache write per miss. |
| `publish` | `{ type: "publish", edge, message?, optional? }` | **Asynchronous.** Publish to the queue or stream behind `edge`. `message` names the operation the consumers will handle (default: the same one). The publisher waits only for broker acceptance. |

**Distribution** isn't a step. It's what distributor nodes do (§6.4): split each operation evenly across
the outgoing targets that can handle it.

How the four routing types the spec requires map onto this model:

| Routing type | Mechanism |
|---|---|
| Sequential | Steps in a flow, executed in order |
| Distribution | Load balancer, API gateway, client, CDN miss path: capability-aware even split |
| Conditional | `cache-lookup` hit/miss, and CDN cacheable-operation hit/miss |
| Asynchronous | `publish` → queue (competing consumers) or stream (every consumer group) |

#### Example: URL Shortener

```
Client ──► Load Balancer ──► API Server ──► Redis
                                   └──────► PostgreSQL

API Server flows:
  redirect: [ cache-lookup(→Redis, populate, onMiss: [ call(→PostgreSQL) ]) ]
  create:   [ call(→PostgreSQL), call(→Redis, as: write, optional) ]
```

With 11,000 rps (redirect 10k, create 1k) and an 80% hit rate, PostgreSQL receives 2,000 reads/s
(misses only) and 1,000 writes/s. Redis receives 10,000 lookups + 2,000 populates + 1,000 writes = 13,000 ops/s.

### 6.3 Outcome categories

The engine keeps four outcomes separate, per operation:

| Outcome | Definition |
|---|---|
| **Accepted** | Requests admitted by the **entry node** (the first node after the client). Requests rejected there were never processed. |
| **Processing succeeded** | Requests whose synchronous flow completed: every required (`optional ≠ true`) step succeeded, recursively. Includes broker acceptance for required `publish` steps. |
| **Published** | For each `publish` step: messages per second accepted by the broker. Publication success is not delivery. |
| **Delivered** | For each queue or stream consumer: messages per second consumed, and the fraction of those whose consumer flow succeeded. Messages that aren't consumed **stay in the backlog**. They are not counted as failed, and the backlog growth rate is reported. |

### 6.4 Component semantics

Notation: `offered` = load arriving per second. Admission fraction `a = min(1, capacity / offered)`
(`a = 1` when `offered = 0`; `a = 0` when the node is down). Only admitted load propagates. Excess is
**rejected** (A-OVERLOAD-SHED). Success values below are probabilities in [0, 1], combined under
A-INDEPENDENT-FAILURE.

| Component | Role | Capacity | Behaviour | Success contribution | Failure scenario | Not modeled |
|---|---|---|---|---|---|---|
| Web / Mobile client | source | unlimited | Emits each operation it issues: `opRate × share_c / Σ share of clients issuing op`. Sends each operation evenly to outgoing targets that can handle it. | Average of target success. 0 if no target can handle it (**unroutable**, error event). | — | Client retries, think time, sessions |
| Load balancer | distributor | `capacityRps` (all ops) | Admit `a`, then split each op evenly across capable targets. Targets with zero effective capacity are excluded (A-HEALTH-CHECKS). | `a × avg(target success)` | — | Algorithms other than even split, sticky sessions, connection limits |
| API gateway | distributor | `min(capacityRps, rateLimitRps?)` | Same as the load balancer. When the rate limit is the binding constraint, rejections are reported as **rate-limited**. Capability-aware routing approximates path-based routing. | `a × avg(target success)` | — | Auth, transformation, per-client limits |
| CDN | edge-cache | `capacityRps` | Admit `a`. For operations in `cacheableOperations`, a fraction `hitRate` is served at the CDN and misses are forwarded like a distributor. Other operations are forwarded entirely. | Cacheable: `a × (h + (1−h) × avg(target))`. Other: `a × avg(target)`. | — | TTLs, invalidation, geographic distribution |
| API server | service | `(instances − failedInstances) × capacityPerInstance` (all ops) | Admit `a`, then execute `flows[op]` steps on the admitted load. **All steps are attempted** even when an earlier one fails (A-NO-SHORT-CIRCUIT: load is an upper bound). | `a × Π success(required steps)` | `app-instance-failure(n)` raises `failedInstances`. At 0 healthy instances the node is down and distributors route around it. | Autoscaling, threads, connection pools, warm-up |
| Background worker | service (consumer) | `(instances − failedInstances) × throughputPerInstance` msg/s | Receives messages only from queues or streams and executes `flows[messageOp]` on consumed messages (`consumed = inflow × a`). **Consumers never reject.** Unconsumed messages stay in the source backlog. | Consumer success = `Π success(required steps)` of consumed messages (`null` when nothing is consumed) | `worker-down` sets capacity to 0, so the backlog grows at the full inflow. | Retries, dead-letter queues, poison messages, ordering |
| Redis cache | cache | `capacityOps` | `cache-lookup`: effective hit fraction `hEff = hitRate × a`, where `a` is computed from lookups + calls. Rejected lookups are treated as misses (A-CACHE-ERROR-AS-MISS). `call` counts as one op. `populate` writes (one per miss) use only capacity left over after lookups and calls (A-POPULATE-BEST-EFFORT). They're included in reported utilization but never affect admission or success. | Lookup step: `hEff + (1 − hEff) × Π success(onMiss required)`. Call step: `a`. | `cache-down` sets `a = 0`, so every lookup misses and every call fails. | Eviction, TTL, memory size; hit rate is an **input**, not derived (A-HIT-RATE-GIVEN) |
| SQL / NoSQL database, Object storage | store | `readCapacity`, `writeCapacity` independent | Sink. A call consumes read or write capacity according to `as` or the operation's kind. | `a_read` or `a_write` | `database-primary-down` sets both capacities to 0. | Replication, failover, locks, query cost, storage size, consistency |
| Message queue | queue | `enqueueCapacity` msg/s | Publish admission `a`. Consumers **compete**: each capable consumer receives a share proportional to its capacity (an even split when all are down, so the demand stays attributed), and consumption is capped by consumer capacity. Backlog growth = accepted inflow − consumed. Messages with no capable consumer are reported as `unroutable`. | Publish step: `a` | — | Time-to-full is reported if `maxDepth` is set, but rejection *after* filling is **not modeled** (event). Retention, visibility timeouts, ordering. |
| Event stream | stream | `ingestCapacity` msg/s | Publish admission `a`. **Every** consumer group (each capable outgoing consumer) receives all accepted messages. A consumer's effective instances are `min(instances, partitions)`. Lag growth is reported per group. | Publish step: `a` | — | Partition skew, retention, rebalancing, exactly-once |

"Capable target": a service with a flow for the operation, or a distributor or CDN with at least one
capable target, or a consumer with a flow for the message operation.

### 6.5 Evaluation pipeline

```
1. validate(doc)           → errors? return { status: "invalid", issues }   (§6.6)
2. applyScenario           → effective capacities (failed instances, down nodes)
3. order                   → topological order of the "evaluation graph":
                             edges + for every cache-lookup on cache C, C → each target in its onMiss subtree
                             (a cache is resolved before miss traffic reaches the stores behind it)
4. forward pass            → for each node in order: total offered → admission a →
                             emit admitted load to targets (distributor split / flow steps).
                             Miss branches are emitted when their cache is resolved.
5. success pass            → memoised recursion over (node, operation, class) using §6.4
6. delivery pass           → consumption, backlog/lag growth, consumer success
7. analysis                → bottlenecks, capacity plan (§6.7), events, explanations, assumptions
```

Every step is O(nodes + edges + steps). Golden tests protect the numerical behaviour.

### 6.6 Validation (errors block simulation)

- Step references an edge that doesn't exist or doesn't start at this node.
- Step and target type mismatch: `cache-lookup` must target a cache, `publish` a queue or stream, and `call` can't target a queue, stream, or client.
- Flows are defined on a non-service node, or reference an unknown operation.
- A cycle in the evaluation graph.
- `onMiss` steps that call the cache being looked up (`LOOKUP_SELF`). Use `populate` instead. This keeps the evaluation graph acyclic.
- No operation with `share > 0`.
- An operation has no route from any client (warning if issued by no client, error if a client issues it but nothing can handle it).
- Warnings: unused connection, a service reachable for an operation it has no flow for, a worker with no inbound queue or stream, a store not used by any flow.

### 6.7 Capacity analysis

Below saturation every load is proportional to `totalRps`, so the engine computes exactly:

- **Breaking point:** `maxRps = totalRps × min over nodes(capacity / load at a = 1)`, plus the node and resource (e.g. "PostgreSQL reads") that saturates first.
- **Instances needed** per service (and consumer) to stay at or below a target utilization (default 70%): `ceil(load / (perInstanceCapacity × 0.7))`.
- **Headroom** per node: `capacity / load`.
- **Sweep:** results across a range of RPS values for charting, from the same engine.

Capacity analysis is computed for the **current scenario** (with failures applied), so users can see how
much headroom a failure removes.

### 6.8 Events, explanations, and unmodeled behaviour

- Each node result includes engine-generated explanation lines (e.g. "Offered 10,000 reads/s vs capacity 5,000 → 50% rejected").
- Events: `saturated`, `rate-limited`, `down`, `unroutable`, `backlog-growing`, `idle`, `unmodeled`.
- `unmodeled` events are emitted when the design implies behaviour the engine doesn't implement. Examples: a failed database while another store of the same type is connected to the same services ("failover/replication not modeled"); a queue with `maxDepth` whose backlog grows ("rejection after the queue fills is not modeled"); optional steps that fail ("retries are not modeled").

### 6.9 Assumptions registry

| ID | Assumption |
|---|---|
| A-STEADY-STATE | Rates are sustained averages. Bursts, warm-up, and transients aren't modeled. |
| A-OVERLOAD-SHED | Load above capacity is rejected immediately, not queued or retried. |
| A-INDEPENDENT-FAILURE | Rejections at different components are independent and uniform across requests. |
| A-NO-SHORT-CIRCUIT | All steps of a flow are attempted even if an earlier step failed, so downstream load is an upper bound. |
| A-HEALTH-CHECKS | Distributors stop routing to components that are fully down. Partially degraded targets still receive an even share. |
| A-EVEN-SPLIT | Distribution is even across capable targets. Queue consumption is proportional to consumer capacity. |
| A-HIT-RATE-GIVEN | Cache and CDN hit rates are inputs chosen by the user or challenge, not derived from data size or TTL. |
| A-CACHE-ERROR-AS-MISS | A rejected or failed cache lookup is treated as a miss, and the request continues to the store. |
| A-POPULATE-BEST-EFFORT | Cache populate writes after a miss use only capacity left over by lookups and calls. |
| A-NO-LATENCY | Latency isn't modeled. The engine reports throughput and success only. |
| A-ILLUSTRATIVE-CAPACITY | Default capacities are illustrative orders of magnitude, not benchmarks. |

The registry is data exported by the engine. The `/docs/simulator` page, each result's
`assumptions[]`, and the AI capability summary are all generated from it.

### 6.10 Illustrative defaults

API server 1,000 rps per instance · LB 50,000 rps · gateway 50,000 rps · Redis 100,000 ops/s ·
SQL 5,000 reads/s and 2,000 writes/s · NoSQL 20,000 / 10,000 · object storage 50,000 / 10,000 ·
queue 50,000 msg/s · stream 100,000 msg/s · worker 200 msg/s per instance · CDN 1,000,000 rps.
These are tuned for clear lessons in the challenges and labelled "illustrative".

### 6.11 Where it runs

In the browser (main thread; Web Worker later if sweeps grow). Guests get full simulation with no
server involvement.

## 7. Authentication and authorization

```
Browser ──supabase-js──► Supabase Auth  (sign-up, verify email, OAuth, reset, refresh)
   │                         │
   │  access_token (JWT)     │ publishes JWKS (asymmetric signing keys)
   ▼                         ▼
ASP.NET JwtBearer: validate signature via cached JWKS, issuer = https://<project-ref>.supabase.co/auth/v1,
                   audience = "authenticated", lifetime; require email verification for AI endpoints
   │
   ▼
ICurrentUser.Id = Guid(sub) ── every query is owner-scoped
```

- Use Supabase **asymmetric JWT signing keys** (JWKS). The API holds no signing secret. Phase 0 Spike B
  confirms issuer, audience, algorithm, and claims against a real hosted project.
- **Lazy provisioning** of `app.user_profiles` on the first authenticated request. No FK to `auth.users`.
- Ownership is filtered in every query, with an EF Core global query filter as a safety net. Integration
  tests assert 404 on cross-user access for every endpoint.
- RLS is enabled with no policies on `app` tables, as defence in depth against Supabase's Data API.

## 8. AI mentor integration

### 8.1 Request flow

```
POST /api/mentor/conversations/{id}/messages        (Bearer JWT, verified email)
  1. Auth + ownership
  2. Per-user rate limit + per-user concurrency limit (1 in-flight request)
  3. Budget reservation (§8.4): reject with 429 if the worst-case cost exceeds remaining user or global budget
  4. Validate context (document vs JSON Schema, sizes, simulation shape); truncate history
  5. Build prompt: static mode prompt + honesty rules + simulator capability summary   [cache breakpoint]
                   challenge content (server-side, trusted)
                   <architecture> JSON (untrusted, delimited) + <simulation engine="vX"> result
                   history + user message
  6. Stream from Claude (official Anthropic C# SDK, NuGet `Anthropic`) → relay as SSE
  7. Settle the budget with actual usage; persist message, usage, and cost
```

### 8.2 Models and parameters (configuration, not code)

| Mode | Default model | Notes |
|---|---|---|
| Tutor | `claude-haiku-5-5` | Low cost. Effort is set explicitly in config. No server-side refusal fallback exists for this model, so a `refusal` stop reason produces a friendly message. |
| Interviewer | `claude-sonnet-5-5` | Effort `low` to start (conversational). Thinking can't be disabled with `disabled` on this model, so the effort level is the cost control. |
| Reviewer | `claude-sonnet-5-5` | Structured outputs (`output_config.format`) for findings. Effort tuned with the prompt eval set. |

- Models, effort, `max_tokens`, and per-model **prices** are all in configuration. Prices are used for cost accounting (§8.4) and must be updated when Anthropic pricing changes.
- Every response checks `stop_reason` (`refusal`, `max_tokens`) before using content. The server-side refusal fallback for Sonnet 5.5 can be enabled by configuration.
- Prompt caching: the stable prefix (mode prompt, honesty rules, capability summary, challenge content) comes before the breakpoint. Verified via `usage.cache_read_input_tokens`. The minimum cacheable prefix differs per model, so we check it when tuning.
- Reviewer findings `{ summary, findings: [{ id, category, severity, confidence, nodeIds[], title, explanation, suggestion }] }` have node IDs validated against the submitted document.

### 8.3 Honesty and safety in prompts

- Simulation numbers are authoritative engine output. The model must not invent metrics, and says "not known" when a number isn't in the result.
- The capability summary (what the simulator does and doesn't model) is generated from the assumption registry and the §6.4 "not modeled" column.
- Uncertainty is expressed explicitly. Findings carry a `confidence`.
- User-controlled text is delimited and described as untrusted data. The AI has no tools.
- The Interviewer withholds solutions and follows a four-step structure, with the step tracked in conversation metadata.

### 8.4 Cost budgets and abuse controls

- **Per-user daily budget: $0.50 (configurable)**, counted in micro-dollars from actual usage:
  `input × inPrice + cacheRead × cacheReadPrice + cacheWrite × cacheWritePrice + output × outPrice`.
  Thinking tokens are billed as output and are included automatically through `usage.output_tokens`.
- **Reserve, then settle.** Before calling, reserve the worst case (estimated input tokens plus `max_tokens` at output price) and reject if it exceeds the remaining budget. After the call, replace the reservation with the actual cost. Combined with a concurrency limit of 1 per user, the budget can't be overshot.
- **Global daily spending cap** (configurable), enforced with the same reserve/settle mechanism on a global counter. When it's reached, AI is disabled for everyone with a clear message. There's also a manual kill switch.
- Per-user rate limit (e.g. 6 requests/min), per-mode `max_tokens` cap, history truncation, request size cap.
- AI is available only to authenticated users with verified email. Guests and unverified users see a CTA, and the API returns 403.
- The UI shows the remaining daily budget as a percentage, not dollars (an internal-cost detail).

## 9. Cross-cutting concerns

- **Errors:** RFC 9457 ProblemDetails with stable `type` URIs. One frontend mapper.
- **Validation:** Zod on the client. JSON Schema and request validation on the server, which is the authority.
- **Concurrency:** `version` + `If-Match` → 412 → conflict dialog.
- **Observability:** structured logs, request IDs, OpenTelemetry traces, AI usage and cost metrics. Frontend error tracking provider TBD.
- **Configuration:** environment variables and .NET user-secrets. `.env.example` documents every key.
- **Testing:** unit tests for the TS packages (including golden challenge tests), schema compatibility fixtures, API integration tests on real Postgres, and Playwright for J1.

## 10. Local development and deployment

**Local:**
- A hosted Supabase **development project** (free tier) provides Auth and Postgres for local development (ADR-007). EF Core points at its Postgres (`app` schema). Verification and reset emails go through Supabase's built-in mailer, which is rate-limited but enough for development.
- The Supabase CLI with Docker is optional. It's a configuration-only switch if offline development or isolated test databases are needed later.
- `dotnet run` for the API and `pnpm dev` for the web app. No Docker Compose.

**Deployment (provider kept configurable; target €20–40/month excluding AI):**

| Piece | Option | Approx. cost |
|---|---|---|
| Static frontend | Cloudflare Pages / Netlify / Vercel free tier | €0 |
| API container | Fly.io / Render / Azure Container Apps / Hetzner VM, 1 small instance | €5–15 |
| Supabase | **Pro plan** (free projects pause when inactive and have limited backups, so they aren't suitable for production) | ~$25 |
| SMTP | Resend / Postmark / Brevo free or entry tier | €0–10 |

- Migrations run as a deploy step (`dotnet ef migrations bundle`), not at app startup.
- The API must not buffer SSE responses. This needs checking per hosting provider.

## 11. Key risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Flow authoring is too much for beginners** | Users must define operations and flows before anything simulates | Challenge starters define operations and flows. The editor suggests flows when edges are drawn (visible and editable). New playgrounds start with a default `read`/`write` operation pair. Validation messages say exactly which flow is missing. |
| Simulator semantics feel arbitrary | Mis-learning, lost trust | Normative §6, assumptions registry, golden tests, explanation lines per node |
| Simulator covers only capacity and availability | Shallow challenges | Estimation exercises and decision checkpoints (ADR-009) |
| TS/C# model drift | Rejected valid saves or accepted invalid ones | Generated JSON Schema, shared fixtures tested in both languages (ADR-022) |
| AI cost overrun | Money | Reserve/settle budgets, global cap, kill switch, concurrency 1 |
| AI wrong but confident | Mis-learning | Honesty rules, confidence per finding, engine-only metrics |
| Supabase email limits | Users can't verify | Custom SMTP before public launch |
| Hosting budget is tight with Supabase Pro | €40 ceiling exceeded if the API host is expensive | Small API instance. Reassess Supabase Pro only at public launch (dev and staging can use free projects). |
| Canvas accessibility | Excludes keyboard and screen-reader users | Keyboard add, inspector, architecture outline; documented gap |
| **$0.50/day may be tight for Interview mode** | A long Sonnet interview re-sends growing history each turn, so one session could use most of a day's budget (rough estimate: 30 turns at ~20k context ≈ $0.25–0.35 with caching) | Prompt caching of history, low effort, history summarization after N turns, and measuring real cost per interview in Phase 5 before launch |
| **Email-verified gate relies on Supabase settings** | Supabase access tokens have no top-level `email_verified`; it sits in `user_metadata` | Require "Confirm email" ON in every environment (deploy checklist). Check `user_metadata.email_verified` when present. Confirm the claim shape in the Spike B end-to-end test. |
| **Shared hosted dev database** | Development data and schema changes live in one hosted project, and the built-in mailer is rate-limited | Resolved for now: use the hosted dev project (ADR-007). EF Core migrations target only the `app` schema. API integration tests use Testcontainers Postgres where Docker is available, otherwise a dedicated test schema. |
