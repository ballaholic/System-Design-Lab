# System Design Lab — Architectural Decisions

Lightweight ADR log. Each entry records context, the decision, alternatives considered, and
consequences. Status values: **Proposed**, **Accepted**, **Superseded by ADR-xxx**.

Review of 2026-10-16: all original ADRs accepted except ADR-005's routing rule, which is replaced by
ADR-021. ADR-011 is revised with the approved model and budget choices. ADR-022 to ADR-024 are new.

---

### ADR-001 — Modular monolith, no real distributed infrastructure — **Accepted**

- **Context:** The product teaches distributed systems, which creates a temptation to build one. The MVP has modest load and a small team.
- **Decision:** One ASP.NET Core API process, one PostgreSQL database, a static SPA. Redis, Kafka, and similar components exist only as simulated playground nodes.
- **Alternatives:** Microservices per feature; a real Redis for rate limiting or caching.
- **Consequences:** Simple deploys. Rate limiting is in-process. Budgets are DB-backed, so they stay correct if we ever scale out.

### ADR-002 — Monorepo: pnpm workspace for TypeScript, separate .NET solution, content folder — **Accepted**

- **Decision:** Single repository with `apps/`, `packages/`, `content/`, `schemas/`, `server/`, plus `prototypes/` for Phase 0.
- **Consequences:** Atomic changes across the model, UI, and backend validation. CI handles both toolchains.

### ADR-003 — TypeScript (Zod) is the canonical architecture model; backend validates via generated JSON Schema — **Accepted**

- **Decision:** Zod schemas in `@sdl/architecture` are the source of truth. JSON Schema is generated, committed, and freshness-checked in CI. The backend validates with JsonSchema.Net and keeps only a minimal C# read model.
- **Alternatives:** C# canonical; hand-mirrored models; protobuf.
- **Consequences:** No logic duplication. Compatibility is enforced by ADR-022.

### ADR-004 — Store architectures as versioned `jsonb` documents — **Accepted**

- **Decision:** One `jsonb` column per design with `schemaVersion`. Migrations run client-side on load.
- **Consequences:** Simple, atomic persistence. See ADR-022 for compatibility testing.

### ADR-005 — Simulation is a deterministic steady-state model, run in the browser — **Accepted (routing rule superseded by ADR-021)**

- **Context:** The goal is educational clarity, reproducibility, and guest access. AI-generated metrics are forbidden.
- **Decision:** A pure TypeScript engine computing sustained rates with admission (`min(1, capacity/offered)`), load shedding on overload, a documented assumptions registry, and client-side execution. *The original "services fan out to all dependencies" rule is replaced by the request-flow model in ADR-021.*
- **Alternatives:** Discrete-event simulation (harder to explain, slower, harder to keep deterministic); a server-side engine.
- **Consequences:** Instant feedback, live mode, cheap sweeps and exact capacity analysis. Latency and transients aren't modeled, and the UI says so.

### ADR-006 — Supabase is used for authentication only; all data goes through the API — **Accepted**

- **Decision:** supabase-js only for auth flows and tokens. All application data goes through the API. RLS is enabled with no policies on `app` tables, as defence in depth.

### ADR-007 — Single PostgreSQL: Supabase's database, EF Core owns schema `app` — **Accepted (local-dev detail revised)**

- **Decision:** App tables live in the `app` schema of the Supabase Postgres. No FK to `auth.users`. Locally, use the Supabase CLI from Phase 1, which requires Docker Desktop. Phase 0 and machines without Docker use a hosted Supabase dev project. No Docker Compose.
- **Consequences:** One database to back up. Account deletion coordinates app rows and the auth user in code.

### ADR-008 — Challenges are versioned content files in the repo, served by the API — **Accepted**

- **Decision:** `content/challenges/<slug>/` files validated in CI, embedded in and served by the API (anonymously). Attempts record `challenge_version`.

### ADR-009 — Challenges teach more than the simulator: estimation exercises and decision checkpoints — **Accepted**

- **Decision:** Stages include deterministic estimation exercises and decision checkpoints alongside simulation criteria. Both work without AI.

### ADR-010 — Completion criteria are evaluated client-side; progress is not tamper-proof — **Accepted**

- **Decision:** The client evaluates criteria and submits results as evidence. The server validates their shape only.
- **Revisit if** competitive or credentialing features are added.

### ADR-011 — Claude via backend only, per-mode models, cost-based budgets — **Accepted (revised)**

- **Context:** Secrets stay server-side. Cost must be bounded in dollars, not just tokens, because the modes use differently priced models.
- **Decision:**
  - The official Anthropic C# SDK, called only from the `Mentor` feature. Responses stream via SSE.
  - Default models (configurable, not hardcoded): Tutor `claude-haiku-5-5`, Interviewer `claude-sonnet-5-5`, Reviewer `claude-sonnet-5-5`. No Opus in the MVP.
  - **Per verified user: $0.50/day** (configurable), computed from actual usage and a configured price table. A **configurable global daily spending cap**, a kill switch, per-request `max_tokens`, a per-user rate limit, and concurrency 1 per user.
  - Reserve the worst case before the call and settle actual cost after (ARCHITECTURE §8.4).
  - No AI for guests or unverified accounts.
- **Alternatives:** Token-count quotas (don't map to spend across models); a monthly budget (one heavy day could exhaust it).
- **Consequences:** Spend is bounded at roughly `users × $0.50` per day, and absolutely by the global cap. The price table must be kept current. Thinking tokens count as output, so effort settings directly affect cost and are tuned per mode.

### ADR-012 — Reviewer returns structured findings linked to node IDs — **Accepted**

- **Decision:** Structured outputs with severity, confidence, and `nodeIds`. Node IDs are validated server-side. The UI highlights the referenced nodes.

### ADR-013 — Frontend state: Zustand for the editor, TanStack Query for server state — **Accepted**

### ADR-014 — Snapshot-based undo/redo with coalescing — **Accepted**

- **Note:** Deleting an edge also deletes the flow steps that reference it, in the same history entry, so undo restores both.

### ADR-015 — Layout is separate from the domain graph inside the document — **Accepted**

### ADR-016 — Single .NET project organised by feature folders — **Accepted**

### ADR-017 — ProblemDetails (RFC 9457) for all API errors — **Accepted**

### ADR-018 — Optimistic concurrency on architectures — **Accepted**

### ADR-019 — Hard deletes and supported account deletion — **Accepted**

### ADR-020 — Illustrative defaults, clearly labelled — **Accepted**

---

### ADR-021 — Explicit, lightweight request-flow model for simulation routing — **Accepted**

- **Context:** The original proposal had services send every request to all connected dependencies. That makes a URL shortener's redirect hit the database even when it should check Redis first, and makes create requests touch the cache lookup path. The simulator would teach the wrong lessons.
- **Decision:**
  - Documents define **operations** (`id`, `kind: read|write`, `share`).
  - **Edges carry no semantics.** Traffic flows over an edge only when a distributor routes over it or a flow step references it.
  - Service nodes define **flows** per operation using exactly three step types: `call` (sequential, optional `as`, `operation`, and `optional`), `cache-lookup` (conditional, with `onMiss` and `populate`), and `publish` (asynchronous, optional `message`).
  - **Distribution** is a component behaviour: a capability-aware even split by load balancers, gateways, clients, and CDN miss paths.
  - Outcomes are reported separately: **accepted**, **processing succeeded**, **published**, **delivered**.
  - Exact per-component semantics and the assumptions are normative in ARCHITECTURE §6.
  - The engine never infers flows. The editor may *suggest* flows, visibly and editably.
- **Explicit non-goals:** loops, arbitrary conditions, retries, timeouts, variables, per-request state, latency. This is not a workflow engine. Adding a step type requires a new ADR.
- **Alternatives considered:**
  - *Edge-level traffic tags (read/write) plus implicit cache-aside*: can't express "create writes to the DB and invalidates the cache", and ambiguous with several stores.
  - *A general workflow DSL*: overkill, hard to explain, hard to test.
  - *Per-endpoint path routing tables on gateways*: unnecessary, because capability-aware routing covers the MVP cases.
- **Consequences:** Accurate lessons for all three MVP challenges (cache-aside reads, write paths, async fan-out). The cost is more authoring, mitigated by challenge starters, suggested flows, and default operations (ARCHITECTURE §11). The flow editor is a new UI surface in Phase 2.

### ADR-022 — Schema compatibility is enforced by shared fixtures tested in TypeScript and .NET — **Accepted**

- **Context:** The architecture schema will evolve, and two validators (Zod and JSON Schema in .NET) must agree.
- **Decision:** `schemas/fixtures/v{N}/` holds valid and invalid sample documents for each released schema version. TS tests migrate every historical fixture to the current version and validate it. .NET tests validate current fixtures against the generated JSON Schema (valid pass, invalid fail). A structural schema change requires a migration, a version bump, and new fixtures, all enforced in CI.
- **Consequences:** Old saved designs keep loading, and the frontend and backend can't silently disagree.

### ADR-023 — Hosting: static frontend, one API container, hosted Supabase; provider-agnostic — **Accepted**

- **Decision:** Target €20–40/month excluding AI. The API is packaged as a standard container image with configuration from environment variables only, so the provider (Fly.io, Render, Azure Container Apps, a VM) can be chosen later. Supabase Pro at public launch; free projects for development and staging.
- **Consequences:** Supabase Pro (~$25) uses most of the budget, so the API must run on one small instance. SSE buffering behaviour must be verified on the chosen provider.

### ADR-024 — Book references in attribution only — **Accepted**

- **Decision:** All educational content is original. Challenges may cite the source book and chapter in an attribution or learning-path note ("Inspired by *System Design Interview* by Alex Xu, Ch. 8"). No reproduced text, figures, or structure that would suggest official affiliation.

---

## Spec items deliberately challenged (summary)

1. Phase order: simulation before challenges, Interview mode after AI. **Accepted.**
2. The simulator's teaching scope is narrow, so challenges add estimation and decision checkpoints. **Accepted.**
3. Shared model across two languages: TS canonical, schema-validating backend. **Accepted**, with compatibility testing (ADR-022).
4. Routing semantics: **revised.** The fan-out rule is replaced by the request-flow model (ADR-021).
5. No guest AI. **Accepted.**
6. Progress isn't tamper-proof. **Accepted.**
7. Added requirements (account deletion, size limits, concurrency, SMTP, outline view). **Accepted.**
