# Prototypes (Phase 0) — not production code

Throwaway experiments that validated architectural assumptions before Phase 1. See
[IMPLEMENTATION_PLAN.md › Phase 0](../docs/IMPLEMENTATION_PLAN.md#phase-0--decisions-and-experiments).

| Folder | Experiment | Status |
|---|---|---|
| [`simulation/`](simulation/) | A — request-flow simulation engine (TypeScript, Vitest) | Complete: 30 tests |
| [`auth-spike/`](auth-spike/) | B — Supabase JWT validation in ASP.NET Core (.NET 10, xUnit v3) | Complete: 16 offline tests + live Supabase test passed (2026-10-17) |

Rules:

- Production code (`apps/`, `packages/`, `server/`, created from Phase 1) **must not import or reference anything under `prototypes/`**. Each prototype is self-contained (its own `package.json` or `.slnx`) and isn't part of any workspace.
- When a prototype is promoted (simulation → `packages/simulation` in Phase 3; auth → `server/.../Infrastructure` in Phase 1), the code is moved and rebuilt to production standards, its tests come along as the regression baseline, and the prototype folder is deleted.
- Never put credentials in this folder. The live Supabase test reads environment variables only.
