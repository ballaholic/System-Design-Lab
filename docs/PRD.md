# System Design Lab — Product Requirements (MVP)

Status: **Approved with revisions** · Last updated: 2026-10-16 (request-flow simulation, AI models and budget, hosting, attribution)

Related: [ARCHITECTURE](ARCHITECTURE.md) · [DATA_MODEL](DATA_MODEL.md) · [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) · [DECISIONS](DECISIONS.md)

---

## 1. Problem and vision

Engineers preparing for system design interviews (or growing into senior roles) mostly learn by
reading. Reading gives vocabulary but not judgment: you don't feel why a cache matters until you watch
a database fall over without one.

System Design Lab is an interactive playground built around one loop:

> **Learn → Design → Simulate → Review → Improve**

Users build architectures on a canvas, push simulated traffic and failures through them, see the
consequences, and discuss their decisions with an AI mentor.

### What the product is honest about

The simulator is a **teaching model**, not a capacity planner. It models request flow, capacity,
caching, saturation, and a small set of failures, all with documented assumptions. It does **not**
model latency distributions, replication, consistency, network partitions, or failover. The UI must
say so where it matters (see §7, "Honesty requirements").

Most of what makes a system design interview hard can't be simulated: data modelling, ID generation,
API design, consistency trade-offs. The product covers those through challenge content, decision
checkpoints, estimation exercises, and the AI mentor, not the simulator.

## 2. Target users

| Persona | Need | Primary features |
|---|---|---|
| **Interview candidate** (mid-level, 2–6 yrs) | Practise a structured approach with feedback | Challenges, Interview mode, Reviewer |
| **Growing engineer** | Build intuition for capacity, caching, async processing | Playground, simulator, failure injection, Tutor |
| **Curious guest** | Try the tool before committing | Guest playground and simulator (no AI) |

Out of scope for the MVP: teams, instructors and classrooms, public sharing, and a content-authoring UI.

## 3. MVP scope

### 3.1 In scope

| Area | MVP capability |
|---|---|
| **Auth** | Email/password sign-up with email verification, login/logout, Google OAuth, password reset, persistent sessions, basic profile, account deletion. Provider: Supabase Auth. |
| **Guest mode** | Full playground and simulator without an account. Designs live in browser storage and can be imported into an account after sign-in. No AI for guests. |
| **Playground** | React Flow canvas, a component library of 13 component types, drag-and-drop, connect, delete, duplicate, a schema-driven property panel, zoom/pan/fit, undo/redo, live validation, save/load, autosave for signed-in users. |
| **Simulation** | Deterministic steady-state **request-flow** model. Users define operations (e.g. redirect, create) and per-service flows with sequential, conditional (cache hit/miss), and asynchronous steps. Distributors split traffic. Inputs: RPS, operation mix (giving the read/write ratio), instances, capacities, cache hit rate. Outputs: per-component utilization, edge throughput, cache hits/misses, rejections, accepted vs processed vs published vs delivered, bottlenecks, breaking point, instances needed, and a sweep chart. |
| **Failure injection** | Four scenarios: primary DB down, cache down, app-server instance failure, worker down. Impact is shown on the canvas and in metrics, with explicit "not modeled" notes. |
| **AI mentor** | Tutor, Interviewer, and Reviewer modes via the backend. Context includes architecture JSON, challenge, assumptions, and simulation results. Reviewer returns structured findings that link to canvas nodes. Includes quotas and rate limits. |
| **Challenges** | Data-driven challenge definitions with stages (progressive requirements), estimation exercises, decision checkpoints, hints, and machine-checkable completion criteria. Three challenges: URL Shortener, Notification System, Search Autocomplete. Guided mode and Interview mode. |
| **Persistence** | Saved designs (CRUD and duplicate), challenge attempts and progress, AI conversation history, simple version history (named checkpoints). |
| **Dashboard and profile** | Continue learning, challenge progress, recent designs, a recommended next challenge, quick actions, and stats derived from real data only. |

### 3.2 Explicitly out of scope (MVP)

- Real-time collaboration and multi-user editing.
- Public or shareable design links and a community gallery.
- Latency simulation (percentiles, queueing delay). It's a candidate for post-MVP and must be clearly labelled if added.
- Replication, sharding, failover, consistency, and partition simulation.
- A content-authoring UI. Challenges are authored as files in the repo.
- Leaderboards or anything that needs tamper-proof progress (see DECISIONS ADR-010).
- Mobile-optimised playground. The playground is desktop-first, and small screens get a read-only notice.
- Payments and subscriptions.
- Internationalisation. Strings stay in English but shouldn't be hardcoded in ways that prevent i18n later.

## 4. Core user journeys

### J1 — Primary MVP acceptance scenario (URL Shortener)

1. A user lands on the site, starts as a guest, or registers and verifies their email.
2. They open the Challenge Library and pick **URL Shortener**.
3. They read the requirements for **Stage 1**: about 100 RPS, reads outnumber writes 10:1.
4. They complete a short **estimation exercise** (QPS and storage over 5 years), with tolerance-based checking.
5. They build Client → Load Balancer → API Servers → SQL DB, then configure instances and capacities.
   The starter defines the `redirect` and `create` operations. The user sets each operation's flow on
   the API server (or accepts the suggested flows).
6. They run the simulation. Stage 1 criteria pass and **Stage 2** unlocks: 11k RPS at the same ratio.
7. The simulation shows the DB **saturated** (read capacity exceeded) and end-to-end success dropping.
8. They add a **Redis cache**, change the `redirect` flow to look up Redis first and read the DB only on
   a miss, and set the hit rate. DB read load falls below capacity and Stage 2 passes.
9. **Stage 3**: they inject *primary DB outage*. Cached reads still succeed, but writes and misses fail.
   The engine notes that failover isn't modeled. The user answers a **decision checkpoint** about
   how they would make writes survive the outage.
10. They ask the **Reviewer** for feedback. Findings appear as cards, and clicking one highlights the related nodes.
11. They save the design. Guests are prompted to sign in, and the guest design is imported.
12. The challenge is marked complete, and the dashboard shows progress and recommends the next challenge.

### J2 — Free-form exploration

A user opens an empty playground, builds an architecture, sweeps RPS to find the breaking point,
injects failures, and asks the Tutor "why did my queue backlog grow?".

### J3 — Interview practice

A user starts a challenge in **Interview mode**. Hints are hidden and the AI interviewer leads:
clarifying requirements, then estimation, then high-level design, then deep dive. It probes decisions
and doesn't hand out answers. The user can ask the Reviewer for a debrief at the end.

### J4 — Returning user

A user logs in and sees "Continue: Notification System — Stage 2" on the dashboard, resumes with the
canvas and conversation restored, and continues.

## 5. Functional requirements

IDs are referenced from the implementation plan.

### 5.1 Authentication and accounts (AUTH)

- **AUTH-1** Email/password registration. Login is blocked until the email is verified, with a resend-verification flow.
- **AUTH-2** Google OAuth sign-in. Accounts with the same verified email are linked by Supabase identity linking (verify the behaviour in Phase 1).
- **AUTH-3** Password reset via an emailed link, landing on a "set new password" page.
- **AUTH-4** Sessions persist across reloads. Tokens are refreshed by the Supabase client.
- **AUTH-5** The backend validates the Supabase JWT on every protected request and derives the user ID from the `sub` claim only.
- **AUTH-6** Every private resource is owner-scoped. Accessing another user's resource returns **404**, never 403, so IDs can't be enumerated.
- **AUTH-7** The profile has a display name and avatar (from OAuth or initials). Users can edit the display name.
- **AUTH-8** **Account deletion** removes all app data and the Supabase auth user. (Added: required for GDPR and basic trust.)
- **AUTH-9** Guest designs (browser storage) can be imported after sign-in. Import is idempotent, so a double import doesn't create duplicates.

### 5.2 Playground (PG)

- **PG-1** The component library is grouped by category and searchable. Components can be added by dragging, or by keyboard (Enter adds at the viewport centre).
- **PG-2** Connections are validated against component connection rules as you make them. Invalid connections are refused with an explanation, for example "A database does not initiate requests to a client".
- **PG-3** Connections are plain links. Traffic semantics come from **operations** (document level) and **flows** on service nodes (ARCHITECTURE §6.2). A flow editor in the right panel lists each operation's steps (`call`, `cache-lookup` with on-miss steps, `publish`). Drawing a connection from a service offers a suggested step, which the user can change. Connections no flow uses are flagged.
- **PG-4** The property panel is generated from the component's config schema, with inline validation, units, and help text that explains each parameter's meaning and illustrative defaults.
- **PG-5** Delete, duplicate, multi-select, zoom/pan/fit, minimap, and keyboard shortcuts (Del, Ctrl+D, Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y, Ctrl+S).
- **PG-6** Undo/redo covers structural changes, config edits, and moves. A drag counts as one history entry, and typing in a field is coalesced.
- **PG-7** Validation runs continuously and shows **errors** (block simulation: a cycle in sync flow, a dangling required dependency) and **warnings** (an isolated node, a store with no path from a client, ambiguous routing).
- **PG-8** Start from an empty canvas, a challenge starter template, or an existing design.
- **PG-9** Signed-in users get explicit save and debounced autosave. Guests get local autosave. A "saved / saving / unsaved / offline" indicator is always visible.
- **PG-10** Conflict handling: saving over a newer server version (another tab) prompts the user to reload or overwrite.
- **PG-11** Limits: at most 150 nodes, 400 edges, and 256 KB per architecture document. These are enforced client-side and server-side.

### 5.3 Simulation (SIM)

- **SIM-1** Traffic profile inputs: total RPS, operation mix (shares; the read/write ratio is derived and shown), and per-client traffic share.
- **SIM-2** Component parameters: instances, per-instance capacity, cache hit rate, DB read/write capacity, and worker throughput. All have illustrative defaults.
- **SIM-3** Outputs: offered/admitted/rejected load per component and resource, utilization, status, per-edge throughput, cache lookups/hits/misses, queue inflow/consumption/backlog growth. **Per operation:** offered, accepted (entry admission), processing succeeded, published (per publish step). **Per consumer:** delivered and consumer success. Also a ranked bottleneck list, breaking-point RPS with the first saturating resource, and instances needed at the target utilization.
- **SIM-4** Visualisation: node badges and colours by utilization, edge labels and widths by throughput, a bottom panel with a metrics table and an event log.
- **SIM-5** **Capacity sweep:** evaluate the model across an RPS range and chart success rate and the first saturating component. This is cheap because the engine is deterministic.
- **SIM-6** **Live mode:** while the simulation panel is open, results recompute automatically (debounced) as the design changes.
- **SIM-7** Every result lists the **assumptions** applied and any **unmodeled** aspects detected in the design, for example "replica present, failover not modeled".
- **SIM-8** Results are versioned with `engineVersion` and are reproducible from (document, traffic profile, scenario).

### 5.4 Failure injection (FAIL)

- **FAIL-1** Scenarios: `database-primary-down`, `cache-down`, `app-instance-failure` (N instances), `worker-down`.
- **FAIL-2** Scenarios apply to user-selected target nodes. Multiple failures can be combined.
- **FAIL-3** Effects follow documented rules (see ARCHITECTURE §6.5). Behaviour that isn't modeled is surfaced as an "unknown / not modeled" event, never silently assumed.

### 5.5 AI mentor (AI)

- **AI-1** Modes: Tutor, Interviewer, Reviewer. Each has a distinct system prompt and UI affordances.
- **AI-2** Context sent per request: current (possibly unsaved) architecture, challenge and stage, user assumptions, latest simulation result (labelled as engine output), and mode.
- **AI-3** Responses stream to the UI.
- **AI-4** The Reviewer returns **structured findings** (category, severity, confidence, related node IDs, explanation, suggestion) plus a narrative summary.
- **AI-5** The AI must quote simulation numbers only from the provided result, must state uncertainty, and must not claim the simulator models things it doesn't.
- **AI-6** Conversations are persisted per user and can be linked to a design and/or challenge attempt. Previous reviews are viewable.
- **AI-7** Limits: a per-user request rate, a **per-user daily cost budget ($0.50, configurable)**, a **global daily spending cap**, max output tokens per mode, history truncation, concurrency 1 per user, usage and cost tracking per message, and a kill switch. The UI shows remaining budget as a percentage.
- **AI-9** Default models (configurable): Tutor Claude Haiku 5.5, Interviewer Claude Sonnet 5.5, Reviewer Claude Sonnet 5.5. No Opus in the MVP.
- **AI-8** AI is available to authenticated users with a verified email only.

### 5.6 Challenges (CH)

- **CH-1** Challenges are defined as versioned content files: metadata, objectives, requirements, constraints, stages, starter architecture, hints, estimation exercises, decision checkpoints, and completion criteria.
- **CH-2** Library page with difficulty and topic filters, and per-user status (not started, in progress, completed).
- **CH-3** Challenge workspace: the playground plus a requirements panel showing the current stage and criteria checklist with live pass/fail.
- **CH-4** Stages unlock sequentially. A stage passes when all its required criteria pass.
- **CH-5** Guided mode shows hints progressively and counts hints used. Interview mode hides hints and starts an Interviewer conversation.
- **CH-6** Attempts persist: stage, criteria results, hints used, linked design, linked conversations.
- **CH-7** Challenge content is original, inspired by Alex Xu's *System Design Interview*. Book and chapter references appear only in an attribution or learning-path note. Nothing is reproduced, and nothing implies official affiliation (ADR-024).
- **CH-8** Interview mode requires AI and therefore an account with a verified email. Guests can use Guided mode only.

### 5.7 Dashboard and profile (DASH)

- **DASH-1** Continue learning: the most recently active in-progress attempt.
- **DASH-2** Challenge progress across all challenges, and recent designs (5).
- **DASH-3** A recommended next challenge, using a simple rule: the next uncompleted challenge in curriculum order, adjusted for difficulty.
- **DASH-4** New users get empty states with a single clear call to action ("Start the URL Shortener challenge").
- **DASH-5** All numbers are derived from persisted data. No placeholder statistics.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance** | Canvas stays at 60 fps during drag with 100 nodes. Simulation evaluates in under 5 ms for 150 nodes, and a sweep of 50 points in under 100 ms. First AI token in under 3 s (p50). |
| **Security** | No secrets in the frontend. JWTs are validated server-side. Ownership is checked on every query. Input is validated at the API boundary (JSON Schema plus size limits). AI prompts treat user content as untrusted data. CORS is restricted to app origins. |
| **Privacy** | Minimal PII (email, display name). Account deletion is supported. AI conversations are stored only for the user. |
| **Accessibility** | WCAG 2.2 AA on non-canvas pages. Canvas: keyboard shortcuts, keyboard add-component, focusable nodes, a property panel fully operable by keyboard, and colour never used as the only status signal (icons and text accompany it). Full keyboard diagram authoring is post-MVP and documented as a known gap. |
| **Reliability** | Autosave plus local draft recovery mean a crash or tab close loses at most a few seconds of work. |
| **Cost control** | AI spend is bounded by per-user and global limits that are configurable without a deploy. |
| **Observability** | Structured logs, request IDs, error tracking for frontend and backend, and AI usage metrics (tokens, latency, errors). |
| **Browser support** | Latest two versions of Chrome, Edge, Firefox, and Safari. |

## 7. Honesty requirements (product-level)

These are part of the product, not implementation details:

1. Every simulated number is produced by the deterministic engine. The AI never generates metrics.
2. Default capacities are labelled **illustrative** ("order of magnitude, for learning").
3. The simulation panel always links to "How the simulator works" (the assumptions page).
4. When a design contains something the engine can't model (replicas, multi-region, sharding hints in labels), the result says so.
5. AI responses are visibly marked as AI-generated and can be wrong. The Reviewer shows a confidence level per finding.
6. No fake activity, fake users, or fake statistics anywhere.

## 8. Success metrics (post-launch, instrumented later)

- The percentage of new users who run their first simulation within 10 minutes.
- URL Shortener completion rate among starters.
- The percentage of stage-2 failures followed by a design change that passes (evidence the loop works).
- AI requests per active user, and cost per completed challenge.

Analytics instrumentation is **not** in the MVP build. These are listed so we design data that can answer them.

## 9. Resolved decisions (review of 2026-10-16)

| Question | Decision |
|---|---|
| Hosting | Static frontend, one ASP.NET Core API, hosted Supabase. €20–40/month excluding AI. Provider chosen later (ADR-023). |
| AI models | Tutor Haiku 5.5; Interviewer and Reviewer Sonnet 5.5; configurable; no Opus (ADR-011). |
| AI budget | $0.50 per verified user per day, plus a configurable global cap (ADR-011). |
| Book references | Attribution or learning-path note only (ADR-024). |
| Guest AI | None. |
| Simulation routing | Explicit request-flow model (ADR-021). |

## 10. Remaining open items

1. **Email provider** for production SMTP. Must be chosen before public launch.
2. **Hosting provider** for the API container. Decide before the Phase 6 deployment.
3. **Frontend error-tracking provider.** Decide in Phase 6.
