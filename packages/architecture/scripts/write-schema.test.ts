// Writes schemas/architecture.schema.json. Run with `pnpm --filter @sdl/architecture schema`; the regular
// test suite fails when the committed file is stale.
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { SCHEMA_PATH, serializeSchema } from "../test/schemaFile";

it("writes the JSON Schema", () => {
  writeFileSync(SCHEMA_PATH, serializeSchema());
});
