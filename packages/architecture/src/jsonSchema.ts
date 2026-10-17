import { z } from "zod";
import { ArchitectureDocumentSchema, CURRENT_SCHEMA_VERSION } from "./schema";

/**
 * The JSON Schema the API validates documents against (ARCHITECTURE §4). Generated in "input" mode: fields with
 * defaults are optional, matching what the client may send.
 */
export function toJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ArchitectureDocumentSchema, { io: "input", target: "draft-2020-12" });
  return {
    $id: `https://systemdesignlab.dev/schemas/architecture.v${CURRENT_SCHEMA_VERSION}.schema.json`,
    title: "System Design Lab architecture document",
    ...schema,
  };
}
