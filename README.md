# System Design Lab

An interactive playground for learning system design: build architectures, simulate traffic and failures,
and get feedback from an AI mentor.

> Status: **Phase 1 (foundation)**: auth, app shell, API and database. See the
> [implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Repository layout

| Path              | What                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | React SPA (Vite, TypeScript, Tailwind CSS v4, shadcn/ui, React Router, TanStack Query)                                          |
| `server/`         | ASP.NET Core API (.NET 10, EF Core, PostgreSQL), see [server/README.md](server/README.md)                                       |
| `packages/config` | Shared TypeScript presets. Domain packages (`architecture`, `simulation`, `challenges`) are added in the phases that need them. |
| `docs/`           | Product, architecture, data model, plan and decisions                                                                           |
| `prototypes/`     | Phase 0 experiments, **not production code**                                                                                    |

## Prerequisites

- Node.js 24 (`.nvmrc`) and pnpm 12 (`npm install -g pnpm`)
- .NET SDK 10
- The hosted Supabase **development** project (ADR-007). Docker is optional: it's only needed to run the
  API's database tests locally (they always run in CI).

## First-time setup

1. **Install dependencies**

   ```bash
   pnpm install
   dotnet tool restore
   ```

2. **Configure Supabase** (dashboard of the dev project):
   - Authentication → URL Configuration: **Site URL** `http://localhost:5173`. Add the **Redirect URLs**
     `http://localhost:5173/auth/callback` and `http://localhost:5173/reset-password`.
   - Authentication → Sign In / Providers → Email: keep **Confirm email** on, and set minimum password
     length 8.
   - Optional, for Google sign-in: see [Google sign-in](#google-sign-in) below.

3. **Web app environment**: copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the project
   URL and **publishable** key.

4. **API secrets**: see [server/README.md](server/README.md#configuration). This covers the project URL and
   the database connection string, stored with `dotnet user-secrets`, never in files.

5. **Create the database schema** (once, and after every new migration):

   ```bash
   dotnet ef database update --project server/src/SystemDesignLab.Api
   ```

## Run

```bash
dotnet run --project server/src/SystemDesignLab.Api   # API on http://localhost:5080
pnpm dev                                              # web on http://localhost:5173 (proxies /api)
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
dotnet test --solution server/SystemDesignLab.slnx
```

CI (`.github/workflows/ci.yml`) runs the same checks, plus the database tests against PostgreSQL via
Testcontainers, on every pull request.

## Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application).
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
2. Supabase → Authentication → Sign In / Providers → **Google**: enable it, and paste the client ID and
   client secret there. They never go in this repository.

Until this is done, "Continue with Google" returns an error from Supabase. Email and password sign-in
works without it.

## Project documents

- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Decisions](docs/DECISIONS.md)
