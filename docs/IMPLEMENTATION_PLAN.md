# System Design Lab — Implementation Plan

Status: **Approved with revisions. Phase 0 complete; Phase 1 not started.** · Last updated: 2026-10-17

Each phase ends with **working, demonstrable functionality** and a checklist of acceptance criteria
that can be verified by running the app or the tests. Requirement IDs (AUTH-1, PG-3, …) refer to
[PRD.md](PRD.md).

## Changes from the original phase order

| Original | Revised | Why |
|---|---|---|
| Phase 3 Challenge → Phase 4 Simulation | **Phase 3 Simulation → Phase 4 Challenge** | Challenge completion criteria depend on simulation results. Building the challenge first would mean structural-only criteria and then rework. Simulation also completes the core *Design → Simulate* loop sooner. |
| Interview mode in Phase 3 | **Interview mode moved to Phase 5** | Interview mode *is* the AI interviewer. It can't exist before AI integration. |
| Auth is part of foundation | Auth stays in Phase 1, but **the playground never depends on it** | Guests use the playground. Auth gates only persistence and AI, so a delay on the auth side doesn't block the core product. |
| — | **Phase 0: decision sign-off and two spikes** | The simulation semantics and the Supabase JWT validation are the two highest-uncertainty items. Both are cheap to de-risk up front. |

## Phase 0 — Decisions and experiments

**Goal:** validate the two riskiest assumptions before scaffolding: that the request-flow simulation
teaches the intended lessons with simple deterministic maths, and that ASP.NET Core can validate
Supabase-issued tokens and identify users correctly.

- Documents reviewed and approved with revisions (2026-10-16). Revisions are recorded in DECISIONS.md.
- **Experiment A — `prototypes/simulation/`:** a standalone TypeScript prototype of the ARCHITECTURE §6
  engine. It covers clients, load balancer, API server, Redis, SQL, queue, and worker; operations and
  flows (`call`, `cache-lookup`, `publish`); admission and shedding; the four outcome categories; the
  failure scenarios; and capacity analysis. It has Vitest tests for each key behaviour, plus a CLI
  report for the URL Shortener stages. CDN, gateway, and event stream are deferred to Phase 3, because
  their semantics are specified but not risky.
- **Experiment B — `prototypes/auth-spike/`:** a minimal ASP.NET Core API that validates Supabase JWTs
  via JWKS and returns the identified user. It has automated tests with locally generated signing keys
  (valid, expired, wrong issuer, wrong audience, tampered, wrong key, missing token), plus an
  end-to-end script against a **hosted Supabase dev project**: sign up or sign in, call the API, and
  compare `sub` to the Supabase user ID.

**Acceptance criteria**
- [x] Documents approved, with changes recorded in DECISIONS.md.
- [x] A: `redirect` reads hit the DB only on cache misses; `create` writes reach the DB and never trigger cache lookups; services receive no traffic for operations they have no flow for.
- [x] A: Stage 2 (11k rps, 10:1) without a cache saturates SQL reads (~50% of redirects fail) while writes stay healthy; with Redis at an 80% hit rate everything succeeds.
- [x] A: Stage 3 (primary DB down, cache present): redirect processing success ≈ hit rate, create = 0%, and an `unmodeled` failover note appears when a second DB exists.
- [x] A: Worker down: publish success stays at 100%, delivery is 0, and backlog growth equals inflow.
- [x] A: Breaking point and instances needed match hand calculations. The engine is deterministic (deep-equal results on repeated runs).
- [x] B: Automated tests pass for all token cases. `401` responses use ProblemDetails.
- [x] B: Signing-key rotation: a token from a newly published key is accepted without a restart, and a never-published key stays rejected.
- [x] B: End to end against the hosted project, a real Supabase session token is accepted and the API's user ID equals the Supabase user ID. **Passed 2026-10-17** (17/17, live test not skipped). Confirmed: issuer `https://<ref>.supabase.co/auth/v1`, audience `authenticated`, JWKS at `/auth/v1/.well-known/jwks.json`, asymmetric signing (the API accepts only ES256/RS256), `role = authenticated`, UUID `sub`, and tampered tokens rejected. Still to confirm in Phase 1, where the AI gate needs it: the exact algorithm and the location of `email_verified`.

Results: [prototypes/simulation/README.md](../prototypes/simulation/README.md) (30 tests) and
[prototypes/auth-spike/README.md](../prototypes/auth-spike/README.md) (16 offline tests + 1 live test).

### Live Supabase integration test — completed 2026-10-17

Passed against a hosted free development project. The steps are kept below so the test can be rerun.
Run the command **from inside** `prototypes/auth-spike`: its `global.json` selects the Microsoft
Testing Platform runner, and `dotnet test` only finds it from that folder.

1. The product owner creates a free hosted Supabase **development** project. The current JWT signing key must be asymmetric (ECC P-256 or RSA), and a throwaway test user is created with **Auto Confirm User**.
2. The product owner sets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_TEST_EMAIL`, and `SUPABASE_TEST_PASSWORD` **locally** and runs `dotnet test` in `prototypes/auth-spike`. No passwords or privileged keys are shared in chat or committed. The secret/service-role key isn't needed at all.
3. Expected: `SupabaseEndToEndTests` passes (not skipped). The API user ID equals the Supabase user ID, and the tampered token is rejected.
4. Record the printed token diagnostics (algorithm, `kid` presence, claim types, `email_verified` location) in `prototypes/auth-spike/README.md`, and update ARCHITECTURE §7 if anything differs from the assumptions.
5. If the project still signs with the legacy HS256 secret, the test fails by design. Rotate to an asymmetric key and rerun.

## Phase 1 — Foundation

**Scope**
- Monorepo: pnpm workspace, `apps/web`, `packages/{architecture,simulation,challenges,config}` (empty
  but wired), and the `server/` solution. Shared lint, format, and tsconfig.
- CI (GitHub Actions): typecheck, lint, Vitest, `dotnet build/test`, JSON Schema freshness check.
- Web: Vite, React, Tailwind v4, shadcn setup; design tokens (dark-first, light override); app shell
  with top nav and responsive layouts; routing; error boundary; 404 page; API client with ProblemDetails
  mapping; TanStack Query provider.
- Auth (AUTH-1…7): register, verify email (hosted dev project mailer), login, logout, Google OAuth, password
  reset, `/auth/callback`, protected-route wrapper, session persistence.
- API: minimal APIs with feature folders, JwtBearer via JWKS, `ICurrentUser`, ProblemDetails, CORS,
  rate-limiter registration, health endpoint, OpenAPI document, EF Core with Npgsql (`app` schema),
  first migration (`user_profiles`), `GET/PATCH /api/me` with lazy provisioning.
- Local dev docs: hosted Supabase dev project setup, `dotnet run`, `pnpm dev`, `.env.example`.

**Acceptance criteria** (status 2026-10-17: implemented and manually verified against the hosted Supabase project. Google OAuth is deferred until a Google OAuth client is set up.)
- [x] A fresh clone plus the README steps runs the web app and API against the hosted Supabase dev project in under 15 minutes.
- [x] Register → verification email received (hosted dev project) → confirm → login → header shows display name from `GET /api/me`.
- [ ] Google OAuth login works against the hosted dev project with a test OAuth client (redirect URL `http://localhost:<port>/auth/callback`). *(Deferred: needs a Google OAuth client.)*
- [x] The password-reset email link lands on the reset page, and the new password works.
- [x] Reload keeps the session. Logout clears it.
- [x] `GET /api/me` without a token → 401 ProblemDetails. With a token from another Supabase project → 401. *(PlatformTests)*
- [x] Integration test: first `/api/me` call creates the profile, and a second call doesn't duplicate it. Concurrent first calls create exactly one row. *(UsersEndpointsTests on Testcontainers PostgreSQL in CI)*
- [x] CI is green, and lint, typecheck, and tests run on every PR. *(PR #2: web and API jobs, including database tests)*
- [x] Dark and light themes render the shell with no hardcoded colours outside the token file. *(The only literal colours are the Google logo's brand colours.)*

## Phase 2 — Architecture playground

**Scope**
- `@sdl/architecture`: Zod schema (including operations and flows), catalog of 13 components,
  connection rules, validation (cycles, isolation, flow and step rules from ARCHITECTURE §6.6, config
  bounds), migrations scaffold, JSON Schema export, and `schemas/fixtures/v1` with TS and .NET
  compatibility tests (ADR-022).
- Flow editor: operations list (name, kind, share), per-service flow editor (add, reorder, and remove
  steps; nested on-miss steps; optional flag), suggested steps when drawing connections, and a warning
  before deleting an edge that flows use.
- Playground UI: library (drag and keyboard add), canvas with custom node components (icon, label,
  status slot), edge component (kind and carries indicator), inspector generated from config schema
  and field metadata, edge inspector, validation panel, toolbar (undo/redo, zoom, fit, save state).
- Editor store with snapshot history and drag/typing coalescing. Keyboard shortcuts.
- Persistence: guest local storage (multiple designs) and local draft recovery. API `Architectures`
  feature (CRUD, duplicate, `If-Match` concurrency, JSON Schema validation, limits). Designs page
  (list, rename, delete, duplicate). Autosave. Guest import on login (AUTH-9).
- Text "outline" view of the architecture (accessibility alternative).

**Acceptance criteria**
- [ ] Unit tests: schema round-trip, each validation rule (positive and negative), connection rules for every component pair class, migration framework with a dummy v0→v1. Coverage ≥ 90% on `@sdl/architecture`.
- [ ] Every component type can be added by drag *and* by keyboard, configured, connected, duplicated, and deleted.
- [ ] Invalid connections (e.g. DB → client) are refused with an explanatory message.
- [ ] Undo/redo restores exact prior state for add, delete, connect, config edit, and move. One drag equals one undo step.
- [ ] A guest reloads the browser and the design is still there. After signing in, the guest design appears in "My designs" exactly once, even if import is triggered twice.
- [ ] Signed-in autosave: edit, wait for "Saved", hard reload, and the change persists.
- [ ] Two tabs editing the same design: the second save gets a conflict prompt. No silent overwrite.
- [ ] Integration tests: user B gets 404 on every `/api/architectures/{id}` route for user A's design; an oversized document (> 256 KB or > 150 nodes) returns 400 ProblemDetails; a schema-invalid document returns 400.
- [ ] 100-node diagram drags smoothly (manual check on a mid-range laptop).

## Phase 3 — Simulation and failure injection

**Scope**
- `@sdl/simulation`: promote the Phase 0 prototype to the package, rebuilt on the `@sdl/architecture`
  types. Add the remaining components (gateway, CDN, event stream, NoSQL, object storage), sweep, the
  full validation set, and a richer `unmodeled` detection. Keep the prototype's tests as the regression
  baseline.
- UI: traffic controls (RPS, read ratio), Run and Live toggle, canvas overlays (status colours plus icons,
  utilization badge, edge throughput labels and width), bottom panel tabs (Summary, Components table,
  Events, Sweep chart), failure-injection menu on nodes and in the toolbar, active-failure chips,
  "How the simulator works" page generated from the registry.

**Acceptance criteria**
- [ ] Engine unit tests cover each role's behaviour, cache-aside with and without a cache failure, the shedding math, success propagation through fan-out, queue backlog growth, the stream fan-out vs. queue competing-consumer difference, each failure scenario, invalid-document handling, and determinism (same input gives a deep-equal output).
- [ ] Golden tests: the URL Shortener stage topologies produce the expected statuses and success rates within tolerance.
- [ ] Simulating a 150-node document takes < 5 ms, and a 50-point sweep < 100 ms, measured with a Vitest benchmark.
- [ ] In the UI: raising RPS until the DB saturates turns the DB "saturated" (colour, icon, and text), lists it first in bottlenecks, and drops the success rate; adding a cache at 80% hit rate fixes it.
- [ ] Injecting *primary DB down* with a cache present: reads succeed at roughly the hit rate, writes are at 0%, and an "unmodeled: failover" event appears if the design contains a second DB.
- [ ] Injecting *worker down* shows backlog growth while publisher success stays at 100%.
- [ ] Every result view shows engine version and links to assumptions. No metric shown in the UI originates outside the engine (code review check).
- [ ] Works fully for guests with no network calls.

## Phase 4 — URL Shortener challenge (Guided mode) and progress

**Scope**
- `@sdl/challenges`: definition schema, criteria evaluator, JSON Schema export, and a content validation script in CI.
- Content: URL Shortener with 3 stages, an estimation exercise, decision checkpoints (ID-generation
  strategy, 301 vs 302, how to keep writes available during a DB outage), progressive hints, and a
  starter template. All writing is original.
- API: `Challenges` (load and validate content at startup, serve anonymously), `Progress` (attempts,
  partial unique index, stage results, answers, hints).
- UI: challenge library (filters by difficulty and topic, per-user status), challenge detail,
  challenge workspace (requirements panel, stage stepper, live criteria checklist, exercise widgets,
  hints), stage-pass moment with an automatic snapshot.
- Dashboard v1: continue learning, challenge progress, recent designs, empty states.

**Acceptance criteria**
- [ ] The CI content check fails on an invalid challenge file (tested with a deliberately broken fixture).
- [ ] Criteria evaluator unit tests cover each criterion kind. Simulation criteria use stage traffic, not sandbox settings.
- [ ] A guest can complete stages 1–3 in Guided mode. Progress is kept locally and migrates on sign-in along with the design.
- [ ] A signed-in user completes stage 1, closes the browser, returns, and the dashboard shows "Continue: URL Shortener — Stage 2". Resuming restores the design and stage.
- [ ] Estimation answers within tolerance are accepted and outside it are rejected, with the worked solution revealed after an attempt.
- [ ] Hints reveal one at a time, and the count persists.
- [ ] Starting a new attempt while one is in progress asks the user to confirm, then abandons the old attempt (the DB constraint holds).
- [ ] A new user's dashboard shows only empty states and a single CTA. No fabricated numbers.
- [ ] J1 steps 1–9 and 11–12 work end to end (step 10, AI review, comes in Phase 5).

## Phase 5 — AI mentor

**Scope**
- API `Mentor`: conversations and messages, Anthropic C# SDK client (model, effort, and max tokens from
  configuration per mode), prompt builder (mode prompts, honesty rules, capability summary from the
  assumption registry, challenge context, delimited architecture and simulation), SSE streaming,
  Reviewer structured output with node-ID validation, rate limiter, daily quota, global kill switch,
  usage persistence, typed error mapping, verified-email requirement.
- UI: mentor panel in the right sidebar with mode switcher, streaming chat, markdown rendering, a
  "context included" disclosure (what's being sent), findings cards that highlight nodes on hover or
  click, quota indicator, conversation history list, and previous reviews per design.
- **Interview mode** for challenges: starting in Interview mode hides hints and opens an Interviewer
  conversation seeded with the challenge.
- Prompt evaluation set: about 20 fixed scenarios (architectures and questions) with expected properties
  ("does not invent metrics", "does not reveal the answer in interviewer mode", "references node IDs that
  exist"), run manually or on a schedule. It isn't run in CI, because each run costs money.

**Acceptance criteria**
- [ ] No Anthropic key in the frontend bundle (CI grep of build output for the key prefix).
- [ ] Tutor answers stream with the first token in under 3 s (p50 measured locally).
- [ ] Reviewer on the stage-2 design returns ≥ 1 finding, and clicking a finding highlights the referenced nodes. Unknown node IDs from the model are dropped (unit test with a stubbed client).
- [ ] When the simulation shows a saturated DB, the Reviewer references the engine's numbers. When asked for a metric that isn't in the result, it says it isn't known (eval set).
- [ ] Interviewer doesn't give a full solution when asked directly in the first turns (eval set), and asks clarifying questions first.
- [ ] Exceeding the per-minute limit returns 429 ProblemDetails with retry-after, and the UI shows a friendly message. Exceeding the daily quota disables input and shows when it resets.
- [ ] Budget tests (fake Claude client with scripted usage): costs are computed from the configured price table; a reservation larger than the remaining $0.50 budget is rejected before calling Claude; concurrent requests can't overshoot the user budget or the global cap; settling releases unused reservation.
- [ ] Mode defaults: Tutor uses Haiku 5.5, Interviewer and Reviewer use Sonnet 5.5, and all are overridable via configuration without a code change.
- [ ] Guests and unverified users see the mentor panel with a clear sign-in or verify CTA, and the API returns 403 for them.
- [ ] Integration tests (with a fake Claude client): ownership of conversations, quota accounting, persistence of usage and findings, a malformed context returns 400.
- [ ] The kill switch disables AI without a redeploy (configuration reload).
- [ ] J1 runs fully end to end, including step 10.

## Phase 6 — MVP completion

**Scope**
- Content: Notification System (async processing, queue and worker scaling, fan-out via event stream,
  worker failure) and Search Autocomplete (read-heavy, caching layers and CDN, the offline data pipeline
  covered by decision checkpoints since the trie itself isn't simulated).
- Version history UI (checkpoints list, restore, auto-checkpoint on stage pass).
- Dashboard: recommended next challenge, learning stats derived from attempts. Profile page with stats
  and account deletion (AUTH-8).
- Playwright E2E for J1 (with a stubbed AI endpoint in CI) and for guest import.
- Accessibility pass (axe on all non-canvas pages, keyboard walkthrough of the playground), performance
  pass, error-tracking integration, production deployment, custom SMTP, production Google OAuth.

**Acceptance criteria**
- [ ] Both new challenges are playable end to end in Guided and Interview modes, and their golden tests pass. No new UI components were required just to add them (validates the data-driven design).
- [ ] Restoring a checkpoint is undoable and doesn't lose the current state.
- [ ] Account deletion removes all app rows and the Supabase user. Logging in again with the same email creates a fresh account.
- [ ] axe reports no serious or critical violations on non-canvas pages.
- [ ] The Playwright J1 suite is green in CI.
- [ ] The production deployment passes a smoke test: register (real email via custom SMTP), complete URL Shortener stage 1, run AI review, delete account.

---

## Simplifications that preserve the learning experience

| Area | Simplification | Why it's safe |
|---|---|---|
| Simulation | Steady state, no time-stepping, no latency | The core lessons (bottlenecks, caching offload, async decoupling, failure blast radius) are all visible in throughput and success rate. Latency can be added later as a clearly labelled extra. |
| Simulation | Two traffic classes (read and write), not per-endpoint flows | Enough for read-heavy vs. write-heavy lessons. Per-endpoint flows can be added later via edge `carries` tags. |
| Simulation | Overload = rejection, not queueing or retries | Simple to explain and visually clear. Documented as an assumption. |
| Failures | Four scenarios, binary up or down | Covers the canonical lessons. Partial degradation can come later. |
| Challenges | Content in repo files, no CMS | Authors are developers for the foreseeable future, and files give review, diff, and CI validation for free. |
| Progress | Client-evaluated, not tamper-proof | There's no competitive element, so cheating only cheats yourself. |
| Version history | Named checkpoints, last 20, no diff view | Covers "go back to before I broke it". |
| Dashboard | Derived from attempts only, no streaks or gamification | Avoids fake-feeling metrics. Can grow once there's real usage. |
| AI | No tools or agentic behaviour; single-turn calls with context | Lower cost, latency, and risk. Prompt injection has a small blast radius. |
| AI | No AI for guests | Removes the largest abuse vector. The guest experience still has full design and simulation. |
| Profile | Display name and avatar only | Nothing else is needed. |
| Mobile | Playground desktop-only; other pages responsive | Diagram editing on a phone is a poor experience regardless. |

## Suggested sequencing within phases

Work vertically: one thin end-to-end slice first (e.g. in Phase 2: add an API server, save, reload),
then widen. Pure TS packages (`architecture`, `simulation`, `challenges`) can be developed ahead of
their UI, test-first, which makes Phase 3 and Phase 4 lower-risk.
