// Writes the generated mentor files. Run with `pnpm --filter @sdl/simulation mentor-files`; the regular test
// suite fails when a committed file is stale.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import {
  CAPABILITIES_PATH,
  SAMPLE_CONTEXT_PATH,
  serializeCapabilities,
  serializeSampleContext,
} from "../test/mentorFiles";

it("writes the mentor files", () => {
  writeFileSync(CAPABILITIES_PATH, serializeCapabilities());
  mkdirSync(path.dirname(SAMPLE_CONTEXT_PATH), { recursive: true });
  writeFileSync(SAMPLE_CONTEXT_PATH, serializeSampleContext());
});
