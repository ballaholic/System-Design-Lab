import { defineConfig } from "vitest/config";

// Used by `pnpm mentor-files` only: regenerates the files the API reads for the AI mentor.
export default defineConfig({ test: { include: ["scripts/write-mentor-files.test.ts"] } });
