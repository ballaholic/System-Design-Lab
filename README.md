# System Design Lab

An interactive playground for learning system design: build architectures, simulate traffic and failures,
and get feedback from an AI mentor.

> Status: **Phase 5 (AI mentor)**: the playground, the request-flow simulator with failure injection, the URL
> Shortener challenge in Guided and Interview modes, and the AI mentor (Tutor, Reviewer, Interviewer). See the
> [implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Repository layout

| Path                    | What                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/web`              | React SPA (Vite, TypeScript, Tailwind CSS v4, shadcn/ui, React Router, TanStack Query)            |
| `server/`               | ASP.NET Core API (.NET 10, EF Core, PostgreSQL), see [server/README.md](server/README.md)         |
| `packages/architecture` | `@sdl/architecture`: document schema, component catalog, connection rules, validation, migrations |
| `packages/simulation`   | `@sdl/simulation`: deterministic request-flow engine, failure scenarios, capacity analysis, sweep |
| `packages/challenges`   | `@sdl/challenges`: challenge schema, content validation, criteria evaluator                       |
| `content/challenges`    | Challenge content: definitions, briefs, starter designs and reference solutions                   |
| `packages/config`       | Shared TypeScript presets                                                                         |
| `schemas/`              | Generated JSON Schema for the API, plus shared fixtures tested in TypeScript and .NET             |
| `docs/`                 | Product, architecture, data model, plan and decisions                                             |
| `prototypes/`           | Phase 0 experiments, **not production code**                                                      |

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

4. **API secrets**: see [server/README.md](server/README.md#configuration). This covers the project URL, the
   database connection string and, for the AI mentor, the Anthropic API key, stored with `dotnet user-secrets`,
   never in files.

5. **Create or update the database schema** (once, and after pulling a new migration):

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
pnpm --filter @sdl/web e2e   # Playwright, guest mode; add PW_CHANNEL=msedge (or chrome) to use an installed browser
pnpm --filter @sdl/simulation bench   # engine performance budget: 150 nodes < 5 ms, 50-point sweep < 100 ms
```

The JSON Schemas in `schemas/` are generated: after changing a schema, run
`pnpm --filter @sdl/architecture schema` or `pnpm --filter @sdl/challenges schema` (a test fails if a
committed file is stale). The challenge content check runs with `pnpm --filter @sdl/challenges test`. The
mentor's capability summary and sample context are generated the same way:
`pnpm --filter @sdl/simulation mentor-files`.

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
