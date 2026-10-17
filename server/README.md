# System Design Lab API

ASP.NET Core (.NET 10) modular monolith: one project organised by feature folders (ADR-016).

```
src/SystemDesignLab.Api/
├─ Common/                 # problem type URIs and other shared contracts
├─ Features/Users/         # /api/me, lazy profile provisioning
├─ Features/Architectures/ # saved designs: CRUD, If-Match concurrency, snapshots, guest import
├─ Features/Challenges/    # challenge catalog loaded from content/challenges at startup
├─ Features/Attempts/      # challenge attempts and progress
├─ Infrastructure/
│  ├─ Auth/                # Supabase JWT validation (JWKS), CurrentUser
│  ├─ Persistence/         # AppDbContext (schema "app"), migrations
│  └─ Web/                 # ProblemDetails, CORS, rate limiting
└─ Program.cs
tests/SystemDesignLab.Api.Tests/   # xUnit v3; database tests use Testcontainers PostgreSQL
```

Without Docker, database tests are skipped locally. To run them against any PostgreSQL server instead, set
`SDL_TEST_POSTGRES` to a connection string for a user that can create databases; each run creates and drops a
throwaway database.

## Configuration

Secrets live in .NET user-secrets locally and in environment variables in deployments. Never put them in
`appsettings*.json`.

```bash
cd server/src/SystemDesignLab.Api
dotnet user-secrets set "Supabase:ProjectUrl" "https://<project-ref>.supabase.co"
dotnet user-secrets set "ConnectionStrings:Database" "<connection string>"
```

**Connection string:** in the Supabase dashboard, click **Connect** and use the **Session pooler**
string (port 5432). The direct connection (`db.<ref>.supabase.co`) is IPv6-only on the free plan, and the
transaction pooler (port 6543) doesn't support prepared statements. Convert it to Npgsql format:

```
Host=aws-0-<region>.pooler.supabase.com;Port=5432;Database=postgres;Username=postgres.<project-ref>;Password=<db password>;SSL Mode=Require
```

| Setting | Purpose | Default |
|---|---|---|
| `Supabase:ProjectUrl` | Token issuer and JWKS location | required |
| `ConnectionStrings:Database` | PostgreSQL (the API owns schema `app`) | required when a request touches the database |
| `Cors:AllowedOrigins` | Browser origins allowed to call the API | `http://localhost:5173` in Development |
| `RateLimiting:PermitsPerMinute` | Global per-user (or per-IP) limit | 300 |

## Database migrations

EF Core migrations manage only the `app` schema. They're applied explicitly, never at startup.

```bash
# from the repository root
dotnet ef migrations add <Name> --project server/src/SystemDesignLab.Api --output-dir Infrastructure/Persistence/Migrations
dotnet ef database update --project server/src/SystemDesignLab.Api
```

After pulling a branch with a new migration (Phase 4 adds `AddChallengeAttemptsAndSnapshots`), run
`dotnet ef database update` again before starting the API.

Every new table must enable row-level security in its migration (see `InitialCreate`). CI fails if the
model has changes without a migration.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | anonymous | Liveness |
| GET | `/api/me` | user | Current profile; created on first request from the token's metadata |
| PATCH | `/api/me` | user | Update `displayName` (1–60 characters) |
| GET | `/api/architectures?cursor=&limit=` | user | Designs list, newest first: `{ items, nextCursor }` (limit 1–100, default 50) |
| POST | `/api/architectures` | user | Create `{ title, description?, document, challengeSlug? }` → 201 with `Location` and `ETag` |
| GET | `/api/architectures/{id}` | owner | Design with its document; `ETag: "<version>"` |
| PUT | `/api/architectures/{id}` | owner | Replace the document; requires `If-Match: "<version>"` |
| PATCH | `/api/architectures/{id}` | owner | Rename / change description (`description: null` clears it); doesn't change the version |
| DELETE | `/api/architectures/{id}` | owner | Delete → 204 |
| POST | `/api/architectures/{id}/duplicate` | owner | Copy as "Copy of …" at version 1 → 201 |
| GET | `/api/architectures/{id}/snapshots` | owner | Snapshots, newest first: `{ items: [{ id, label, createdAt, nodeCount }] }` |
| POST | `/api/architectures/{id}/snapshots` | owner | Snapshot `{ label, document? }` (the stored document when omitted) → 201; keeps the newest 20 |
| POST | `/api/architectures/import` | user | Idempotent guest import of up to 10 designs and 10 attempts keyed by `importKey` → `{ results, attemptResults }` |
| GET | `/api/challenges` | anonymous | Catalog `{ items: [{ slug, version, title, summary, difficulty, topics, order, stageCount, stages }] }` |
| GET | `/api/challenges/{slug}` | anonymous | Definition as authored, plus each stage’s `briefMd` and the `starter` design |
| GET | `/api/attempts?status=` | user | Attempts, most recently active first (max 100) |
| GET | `/api/attempts/{id}` | owner | One attempt |
| POST | `/api/attempts` | user | Start `{ challengeSlug, mode: "guided", architectureId?, restart? }` → 201; **409** `attempt-in-progress` with `attemptId` unless `restart: true` |
| PATCH | `/api/attempts/{id}` | owner | Update `currentStageId`, `stageResults`, `exerciseAnswers`, `hintsRevealed`, `architectureId`, `status` (`completed`/`abandoned`); **409** once not in progress |
| GET | `/openapi/v1.json` | Development only | OpenAPI document |

Errors are RFC 9457 problem details with stable `type` URIs (`Common/ProblemTypes.cs`) and a `traceId`.
Another user's design is always **404**, never 403 (AUTH-6).

**Documents and concurrency.** Documents are validated against `schemas/architecture.schema.json` (generated
from `@sdl/architecture` and embedded in the API at build time) and limited to 256 KB; only the current
`schemaVersion` is accepted. The design's `version` is its concurrency token: `GET` returns it as the `ETag`,
and `PUT` must send it back in `If-Match`. A missing `If-Match` returns **428**; a stale one returns **412**
(`type` `.../conflict`) with `currentVersion`, so the client can offer reload or overwrite. Request bodies are
limited per endpoint (512 KB for one document, 3 MB for import, 64 KB otherwise); larger bodies get **413**.

**Challenges and attempts.** Challenge definitions are repo content (ADR-008): `content/challenges/**` (without
`solutions/`) is copied next to the API and validated at startup against `schemas/challenge.schema.json`; invalid
content stops the API from starting, with every problem listed. Set `Challenges:ContentPath` to load content from
elsewhere. Attempt progress is evaluated in the browser and stored as evidence (ADR-010): the API checks that
stage, exercise, option and hint ids exist in the current definition and that values have the documented shape,
but never re-runs the simulation. At most one attempt per challenge is in progress (partial unique index).
Interview mode returns 400 until the AI mentor arrives.
