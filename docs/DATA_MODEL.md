# System Design Lab — Domain and Persistence Model

Status: **Approved with revisions** · Last updated: 2026-10-16 (request-flow model, cost-based AI budgets)

Two layers:

1. **Domain documents** are versioned JSON shapes defined in TypeScript (Zod): the architecture,
   simulation inputs and results, and challenge definitions. They are shared by the editor, simulator,
   criteria evaluator, persistence, and AI prompts.
2. **Persistence entities** are PostgreSQL tables in schema `app`, managed by EF Core. They store
   ownership, metadata, and documents as `jsonb`.

TypeScript below is illustrative of the Zod schemas, not final code.

---

## 1. Architecture document (`@sdl/architecture`)

```ts
type ArchitectureDocument = {
  schemaVersion: 1;
  operations: Operation[];                              // ≥ 1; request types users send
  nodes: ArchNode[];
  edges: ArchEdge[];
  layout: Record<NodeId, { x: number; y: number }>;   // presentation; ignored by simulator
  edgeLayout?: Record<EdgeId, { source?: EdgeSide; target?: EdgeSide }>; // presentation: sides a line leaves/enters
  notes?: string;                                       // free-form user assumptions / notes (≤ 4 KB)
  traffic?: TrafficProfile;                             // last-used simulation inputs
};

type Operation = {
  id: OperationId;           // slug, unique within doc, e.g. "redirect"
  name: string;              // "Follow short link"
  kind: "read" | "write";    // default store capacity class used by calls
  share: number;             // relative weight in the traffic mix (≥ 0; 0 = internal/message-only)
};

type ArchNode = {
  id: NodeId;                // stable, client-generated (nanoid), unique within doc
  type: ComponentType;       // key into the component catalog
  label: string;             // ≤ 60 chars, user-editable
  config: Record<string, unknown>;  // validated by catalog[type].configSchema
  flows?: Record<OperationId, FlowStep[]>;  // service-role nodes only (API server, worker)
};

type ArchEdge = {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  label?: string;
  // No traffic semantics: edges carry traffic only when a distributor routes over them
  // or a flow step references them (ARCHITECTURE §6.2). Sync/async rendering is derived
  // from the target type (queue/stream ⇒ async).
};

type FlowStep =
  | { type: "call"; edge: EdgeId; operation?: OperationId; as?: "read" | "write"; optional?: boolean }
  | { type: "cache-lookup"; edge: EdgeId; onMiss: FlowStep[]; populate?: boolean }
  | { type: "publish"; edge: EdgeId; message?: OperationId; optional?: boolean };
```

Design notes:

- **Operations and flows** are the request-flow model (ADR-021). Three step types, one nesting
  construct (`onMiss`), maximum nesting depth 3, at most 20 steps per flow.
- New playground documents start with two operations, `read` (share 9) and `write` (share 1). Challenge
  starters define their own operations, e.g. `redirect` and `create`.
- `layout` is kept separate from `nodes`, so the model has no UI fields. The simulator and AI context
  builder can omit it entirely. It still lives in the same document so that save, undo, and import stay
  atomic.
- Node `config` is typed per component through the catalog. Unknown keys are stripped on load, and
  missing keys are filled from defaults. This is also how the catalog evolves without document
  migrations.
- `edgeLayout` follows the same rule as `layout`: it records which side of each box a connection
  leaves and enters (`EdgeSide` is `"top" | "right" | "bottom" | "left"`). Only sides that differ from the
  default (out on the right, in on the left) are stored, entries go with their connection, and the
  simulator and its input hash ignore it. It's optional and additive, so it needed no version bump.
- Document migrations (`schemaVersion` bumps) are needed only for structural changes.

### 1.1 Component catalog

```ts
type ComponentDefinition<C> = {
  type: ComponentType;                 // e.g. "redis-cache"
  category: "client" | "application" | "storage" | "caching" | "messaging";
  role: "source" | "distributor" | "service" | "consumer" | "cache" | "edge-cache"
      | "store" | "queue" | "stream";  // drives simulation routing (ARCHITECTURE §6.3); consumer = background worker
  display: { name: string; description: string; icon: IconKey };
  configSchema: ZodType<C>;            // also drives inspector form generation
  defaults: C;
  fieldMeta: Record<keyof C, { label: string; unit?: string; help: string }>;
  connections: {
    canTarget: ConnectionRule[];       // allowed (targetRole/category, kind, default carries)
    maxInbound?: number;
  };
};
```

Initial component types and key configuration:

| Type | Role | Key config (illustrative defaults) |
|---|---|---|
| `web-client` | source | `share` (traffic weight, 1), `operations?` (operations it sends; default all) |
| `mobile-client` | source | `share` (1), `operations?` |
| `api-gateway` | distributor | `capacityRps` (50k), `rateLimitRps?` (optional; excess rejected) |
| `load-balancer` | distributor | `capacityRps` (50k) |
| `api-server` | service | `instances` (2), `capacityPerInstanceRps` (1k), `failedInstances` (scenario-driven, not user config) |
| `background-worker` | consumer | `instances` (1), `throughputPerInstance` (200 msg/s) |
| `sql-database` | store | `readCapacity` (5k/s), `writeCapacity` (2k/s) |
| `nosql-database` | store | `readCapacity` (20k/s), `writeCapacity` (10k/s) |
| `object-storage` | store | `readCapacity` (50k/s), `writeCapacity` (10k/s); labelled "effectively high" |
| `redis-cache` | cache | `hitRate` (0.8), `capacityOps` (100k/s) |
| `cdn` | edge-cache | `hitRate` (0.9), `cacheableOperations` (default: all `read` operations), `capacityRps` (1M) |
| `message-queue` | queue | `enqueueCapacity` (50k/s), `maxDepth?` |
| `event-stream` | stream | `ingestCapacity` (100k/s), `partitions` (8); caps each consumer's effective instances |

Exact per-component semantics are normative in ARCHITECTURE §6.4.

### 1.2 Validation issues

```ts
type ValidationIssue = {
  code: string;               // e.g. "SYNC_CYCLE", "ISOLATED_NODE", "AMBIGUOUS_READ_ROUTING"
  severity: "error" | "warning" | "info";
  message: string;            // user-facing, educational
  nodeIds?: NodeId[]; edgeIds?: EdgeId[];
};
```

Errors block simulation, and warnings don't.

## 2. Simulation types (`@sdl/simulation`)

```ts
type TrafficProfile = {
  totalRps: number;                          // 0 < x ≤ 10_000_000
  mix?: Record<OperationId, number>;         // overrides Operation.share for this run (challenge stages use this)
};

type FailureScenario = {
  failures: Array<
    | { kind: "database-primary-down"; nodeId: NodeId }
    | { kind: "cache-down"; nodeId: NodeId }
    | { kind: "app-instance-failure"; nodeId: NodeId; count: number }
    | { kind: "worker-down"; nodeId: NodeId }
  >;
};

type Resource = "total" | "read" | "write";   // stores have read/write; everything else "total"

type NodeResult = {
  status: "ok" | "warm" | "saturated" | "down" | "idle";
  resources: Partial<Record<Resource, {
    capacity: number; offered: number; admitted: number; rejected: number; utilization: number;
  }>>;
  byOperation: Record<OperationId, { offered: number; admitted: number }>;
  rateLimited?: number;                          // gateways
  cache?: { lookups: number; hits: number; misses: number; effectiveHitRate: number; otherOps: number;
            populateOffered: number; populateAdmitted: number };   // caches and CDNs
  queue?: { kind: "queue" | "stream"; inflow: number; accepted: number; consumed: number;
            backlogGrowthPerSec: number; consumerGroups: number; secondsToFull?: number };   // queues and streams
  headroom?: number;                             // min capacity / offered over resources
  explanation: string[];                         // engine-generated "why" lines
};

type OperationOutcome = {
  offered: number;                               // rps entering from clients
  accepted: number;                              // admitted by the entry node
  processingSucceeded: number;                   // synchronous flow completed (required steps)
  processingSuccessRate: number;                 // processingSucceeded / offered
  publications: Array<{ nodeId: NodeId; operation: OperationId; stepPath: number[];
                        brokerId: NodeId; message: OperationId; attempted: number; published: number }>;
};

type DeliveryOutcome = {                         // per (queue|stream, consumer)
  brokerId: NodeId; consumerId: NodeId; message: OperationId;
  inflow: number; consumed: number; backlogGrowthPerSec: number;
  consumerSuccessRate: number | null;            // of consumed messages; null when nothing is consumed
};

type SimulationResult = {
  engineVersion: string;                         // semver of @sdl/simulation
  inputHash: string;                             // hash(doc minus layout, traffic, scenario)
  status: "ok" | "invalid";                      // "invalid" results carry only the fields above and issues/assumptions
  issues: ValidationIssue[];
  nodes: Record<NodeId, NodeResult>;
  edges: Record<EdgeId, number>;                 // rps/msg-s flowing over each edge
  operations: Record<OperationId, OperationOutcome>;
  deliveries: DeliveryOutcome[];
  summary: { offered: number; processingSucceeded: number; processingSuccessRate: number; bottlenecks: Array<{ nodeId: NodeId; resource: Resource; utilization: number }> };
  capacity: {
    breakingPointRps: number | null;             // null when nothing is constrained
    firstSaturation?: { nodeId: NodeId; resource: Resource };
    instancesNeeded: Record<NodeId, number>;     // services/consumers at target utilization
    targetUtilization: number;                   // default 0.7
  };
  events: SimEvent[];   // { kind: "saturated"|"rate-limited"|"down"|"unroutable"|"backlog-growing"|"idle"|"unmodeled", nodeIds, message }
  assumptions: AssumptionId[];
};

type SweepResult = {
  status: "ok" | "invalid"; engineVersion: string; inputHash: string; issues: ValidationIssue[];
  breakingPointRps: number | null;
  points: Array<{ rps: number; processingSuccessRate: number; operations: Record<OperationId, number>;
                  firstSaturated?: { nodeId: NodeId; resource: Resource } }>;
};
```

## 3. Challenge definition (`@sdl/challenges`, files in `content/challenges/*`)

```ts
type ChallengeDefinition = {
  schemaVersion: 1;
  slug: string;                       // "url-shortener"
  version: number;                    // bump on criteria changes; attempts record the version
  title: string;
  summary: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  topics: string[];                   // "caching", "async-processing", ...
  order: number;                      // curriculum order
  reference?: { source: string; chapter?: number };  // attribution only
  objectives: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  constraints: string[];              // assumptions given to the learner
  starterArchitecture?: string;       // file name, e.g. "starter.json"
  allowedComponents?: ComponentType[];
  stages: ChallengeStage[];
};

type ChallengeStage = {
  id: string;                         // "s1-baseline"
  title: string;
  brief: string;                      // markdown file name; original writing
  traffic: TrafficProfile;            // stage-defined load
  scenario?: { failures: Array<{ kind: FailureKind; target: { type: ComponentType; pick?: "first" | "most-writes" }; count?: number }> };
  exercises?: Exercise[];             // estimation / decision checkpoints
  hints: Array<{ id: string; md: string }>;   // progressive
  criteria: Criterion[];
};

type Exercise =
  | { kind: "estimate"; id: string; prompt: string; unit: string; expected: number; tolerance: number; workedSolution: string } // relative tolerance; markdown
  | { kind: "decision"; id: string; prompt: string; options: Array<{ id: string; label: string; feedback: string; recommended?: boolean }> };

type Criterion =
  | { kind: "has-component"; id: string; description: string; category?: string; type?: ComponentType; min?: number }
  | { kind: "path-exists"; id: string; description: string; fromRole: string; toType: ComponentType; via?: ComponentType[] }
  | { kind: "sim-success-rate"; id: string; description: string; operation?: OperationId; min: number }   // processing success; omit operation = overall
  | { kind: "sim-backlog-stable"; id: string; description: string; brokerType?: ComponentType }       // no consumer falling behind
  | { kind: "has-flow"; id: string; description: string; operation: OperationId; usesStep?: "cache-lookup" | "publish" }
  | { kind: "sim-no-saturation"; id: string; description: string; types?: ComponentType[] }
  | { kind: "sim-max-utilization"; id: string; description: string; type: ComponentType; max: number }
  | { kind: "exercise-completed"; id: string; description: string; exerciseId: string }   // this or an earlier stage
  | { kind: "review-requested"; id: string; description: string; optional: true };          // Phase 5
// Every criterion may be marked optional: optional criteria don't block a stage.
```

`evaluate(stage, doc, simResultForStage, exerciseAnswers) → CriterionResult[]`, where
`CriterionResult = { id, passed, detail }`. Simulation criteria run the engine with the **stage's**
traffic and scenario, not the user's sandbox settings, so passing a stage means something.

*As built in Phase 4:* the content check (`packages/challenges/test/content.test.ts`, part of `pnpm test`)
validates every folder in `content/challenges`: schema, referenced files, unique ids, references between
criteria, exercises and operations, a valid starter, and that each stage's reference solution in
`solutions/<stageId>.json` passes while the starter doesn't pass stage 1. Exercise answers are
`{ kind: "estimate", value, correct, attempts, revealed, answeredAt }` or
`{ kind: "decision", optionId, answeredAt }`; an estimate counts as done when it's correct or its solution was revealed.

## 4. Persistence (PostgreSQL, schema `app`)

All IDs are `uuid`. Timestamps are `timestamptz` in UTC. `owner_id` / `user_id` always equal the
Supabase `sub`.

### 4.1 Entity overview

```
user_profiles 1 ──< architectures 1 ──< architecture_snapshots
      │                   ▲
      │                   │ (nullable)
      ├──< challenge_attempts ──< ai_conversations (nullable attempt link)
      │                                │
      ├──< ai_conversations 1 ──< ai_messages
      │
      └──< ai_usage_daily
```

### 4.2 Tables

**`user_profiles`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | = Supabase `sub`. No FK to `auth.users` (ADR-007). |
| `display_name` | text | ≤ 60 |
| `avatar_url` | text null | from OAuth metadata |
| `created_at`, `updated_at` | timestamptz | |

**`architectures`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | indexed; FK → user_profiles ON DELETE CASCADE |
| `title` | text | ≤ 100, required |
| `description` | text null | ≤ 1000 |
| `document` | jsonb | ArchitectureDocument, ≤ 256 KB |
| `schema_version` | int | copy of `document.schemaVersion` for queries/migrations |
| `challenge_slug` | text null | set when created from a challenge |
| `import_key` | uuid null | guest-import idempotency; unique (owner_id, import_key) |
| `version` | int | optimistic concurrency, incremented per update |
| `created_at`, `updated_at` | timestamptz | index (owner_id, updated_at desc) for "recent designs" |

**`architecture_snapshots`** (simple version history)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `architecture_id` | uuid | FK ON DELETE CASCADE |
| `label` | text | user-provided ("Before adding cache") or auto ("Stage 2 passed") |
| `document` | jsonb | |
| `created_at` | timestamptz | |

Retention: the last 20 per architecture, pruned on insert. Snapshots are created explicitly
("Save checkpoint") or automatically when a challenge stage passes. Autosaves don't create snapshots.

**`challenge_attempts`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | FK CASCADE |
| `challenge_slug` | text | |
| `challenge_version` | int | the definition version when the attempt started |
| `mode` | text | `guided` \| `interview` |
| `status` | text | `in_progress` \| `completed` \| `abandoned` |
| `current_stage_id` | text | |
| `architecture_id` | uuid null | FK SET NULL |
| `stage_results` | jsonb | `{ [stageId]: { passedAt?, criteria: CriterionResult[], engineVersion } }` |
| `exercise_answers` | jsonb | `{ [exerciseId]: { value \| optionId, correct, answeredAt } }` |
| `hints_revealed` | text[] | hint IDs |
| `import_key` | uuid null | guest-import idempotency; unique (user_id, import_key) |
| `started_at`, `last_activity_at`, `completed_at` | timestamptz | index (user_id, last_activity_at desc) |

Constraint: at most one `in_progress` attempt per (user, challenge), enforced by a partial unique index.
Restarting a challenge abandons the current attempt.

Note: criteria results are **client-evaluated** and stored as evidence (ADR-010). The server validates
their shape and that the stage IDs exist in the definition, but doesn't re-run the engine.

**`ai_conversations`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | FK CASCADE |
| `mode` | text | `tutor` \| `interviewer` \| `reviewer` |
| `title` | text | auto from first message, editable |
| `architecture_id` | uuid null | FK SET NULL |
| `attempt_id` | uuid null | FK SET NULL |
| `metadata` | jsonb | e.g. interviewer step |
| `created_at`, `updated_at` | timestamptz | |

**`ai_messages`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `conversation_id` | uuid | FK CASCADE; index (conversation_id, created_at) |
| `role` | text | `user` \| `assistant` |
| `content` | text | |
| `findings` | jsonb null | Reviewer structured output |
| `context_ref` | jsonb null | `{ architectureHash, simInputHash, engineVersion, challenge, stage }`. A reference, not a full copy, to limit storage. Full context is optional and debug-only. |
| `model` | text null | |
| `input_tokens`, `output_tokens`, `cache_read_tokens` | int null | |
| `status` | text | `complete` \| `error` \| `truncated` |
| `created_at` | timestamptz | |

**`ai_usage_daily`**
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | PK part |
| `day` | date | PK part (UTC) |
| `requests` | int | |
| `input_tokens`, `output_tokens`, `cache_read_tokens` | bigint | |
| `cost_micros` | bigint | settled cost in micro-dollars (1 USD = 1,000,000) |
| `reserved_micros` | bigint | in-flight reservations (ARCHITECTURE §8.4) |

**`ai_spend_global_daily`**
| Column | Type | Notes |
|---|---|---|
| `day` | date PK | UTC |
| `cost_micros`, `reserved_micros` | bigint | compared against the configured global cap |

Reserve and settle are single atomic `UPDATE … WHERE cost_micros + reserved_micros + @reservation <= @cap RETURNING …`
statements (one per counter, in one transaction). Zero rows updated means the budget is exhausted.
`ai_messages` also stores `cost_micros` per assistant message.

### 4.3 Not stored in the database

- **Challenge definitions.** These are repo content, loaded and validated at API startup and cached in memory (ADR-008).
- **Simulation results**, except the criteria results stored as attempt evidence and context references on AI messages.
- **Guest data.** It stays in browser storage until imported.

### 4.4 Deletion semantics

- Hard deletes, keeping the MVP simple. Deleting an architecture cascades its snapshots and nulls links in attempts and conversations.
- Account deletion deletes `user_profiles` (which cascades everything), then calls the Supabase Admin
  API to delete the auth user. The steps are idempotent, so a retry after a partial failure is safe.

## 5. API resource summary

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/me` | user | Profile (provisions on first call) |
| `PATCH /api/me` | user | Update display name |
| `DELETE /api/me` | user | Delete account |
| `GET /api/architectures?cursor=` | user | List (title, updated, challenge, node count) |
| `POST /api/architectures` | user | Create |
| `GET /api/architectures/{id}` | owner | Get (ETag = version) |
| `PUT /api/architectures/{id}` | owner | Update (`If-Match`) |
| `PATCH /api/architectures/{id}` | owner | Rename / description |
| `DELETE /api/architectures/{id}` | owner | Delete |
| `POST /api/architectures/{id}/duplicate` | owner | Duplicate |
| `POST /api/architectures/import` | user | Idempotent guest import (batch ≤ 10 designs plus their guest challenge attempts) |
| `GET/POST /api/architectures/{id}/snapshots` | owner | List / create checkpoint |
| `POST /api/architectures/{id}/snapshots/{sid}/restore` | owner | Restore into current |
| `GET /api/challenges` | anonymous | Catalog |
| `GET /api/challenges/{slug}` | anonymous | Definition (including stages and markdown) |
| `GET /api/attempts?status=` | user | User attempts |
| `GET /api/attempts/{id}` | owner | One attempt |
| `POST /api/attempts` | user | Start (`challengeSlug`, `mode`, `architectureId`, `restart`); 409 `attempt-in-progress` with `attemptId` unless `restart` |
| `PATCH /api/attempts/{id}` | owner | Update stage results, answers, hints, architecture link |
| `GET /api/mentor/conversations?mode=&architectureId=` | user | List |
| `POST /api/mentor/conversations` | verified user | Create |
| `GET /api/mentor/conversations/{id}` | owner | Messages |
| `POST /api/mentor/conversations/{id}/messages` | verified owner | Send; response is an SSE stream |
| `GET /api/mentor/quota` | user | Remaining daily budget |
