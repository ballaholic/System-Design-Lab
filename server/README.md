# System Design Lab API

ASP.NET Core (.NET 10) modular monolith: one project organised by feature folders (ADR-016).

```
src/SystemDesignLab.Api/
├─ Common/                 # problem type URIs and other shared contracts
├─ Features/Users/         # /api/me, lazy profile provisioning
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

## API (Phase 1)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | anonymous | Liveness |
| GET | `/api/me` | user | Current profile; created on first request from the token's metadata |
| PATCH | `/api/me` | user | Update `displayName` (1–60 characters) |
| GET | `/openapi/v1.json` | Development only | OpenAPI document |

Errors are RFC 9457 problem details with stable `type` URIs (`Common/ProblemTypes.cs`) and a `traceId`.
