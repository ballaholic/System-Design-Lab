import { defineConfig } from "vitest/config";

// Used by `pnpm schema` only: runs the script that regenerates schemas/challenge.schema.json.
export default defineConfig({ test: { include: ["scripts/write-schema.test.ts"] } });
