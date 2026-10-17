import { defineConfig } from "vitest/config";

// Used by `pnpm mentor-evals` only: regenerates evals/mentor/scenarios.json for the mentor's prompt evaluation set.
export default defineConfig({ test: { include: ["scripts/write-mentor-evals.test.ts"] } });
