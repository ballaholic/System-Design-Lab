# System Design Lab API

ASP.NET Core (.NET 10) modular monolith: one project organised by feature folders (ADR-016).

```
src/SystemDesignLab.Api/
├─ Common/                 # problem type URIs and other shared contracts
├─ Features/Users/         # /api/me, lazy profile provisioning
├─ Features/Architectures/ # saved designs: CRUD, If-Match concurrency, guest import
├─ Infrastructure/
│  ├─ Auth/                # Supabase JWT validation (JWKS), CurrentUser
│  ├─ Persistence/         # AppDbContext (schema "app"), migrations
│  └─ Web/                 # ProblemDetails, CORS, rate limiting
└─ Program.cs
tests/SystemDesignLab.Api.Tests/   # xUnit v3; database tests use Testcontainers PostgreSQL
```

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
| POST | `/api/architectures/import` | user | Idempotent guest import of 1–10 designs keyed by `importKey` → `{ results: [{ importKey, id, created }] }` |
| GET | `/openapi/v1.json` | Development only | OpenAPI document |

Errors are RFC 9457 problem details with stable `type` URIs (`Common/ProblemTypes.cs`) and a `traceId`.
Another user's design is always **404**, never 403 (AUTH-6).

**Documents and concurrency.** Documents are validated against `schemas/architecture.schema.json` (generated
from `@sdl/architecture` and embedded in the API at build time) and limited to 256 KB; only the current
`schemaVersion` is accepted. The design's `version` is its concurrency token: `GET` returns it as the `ETag`,
and `PUT` must send it back in `If-Match`. A missing `If-Match` returns **428**; a stale one returns **412**
(`type` `.../conflict`) with `currentVersion`, so the client can offer reload or overwrite. Request bodies are
limited per endpoint (512 KB for one document, 3 MB for import, 64 KB otherwise); larger bodies get **413**.
