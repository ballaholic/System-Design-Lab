// Writes schemas/architecture.schema.json. A test fails when the committed file is stale.
import { writeFileSync } from "node:fs";
import { SCHEMA_PATH, serializeSchema } from "../test/schemaFile";

writeFileSync(SCHEMA_PATH, serializeSchema());
console.log(`Wrote ${SCHEMA_PATH}`);
