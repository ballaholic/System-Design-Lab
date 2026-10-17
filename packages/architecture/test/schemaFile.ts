import path from "node:path";
import { toJsonSchema } from "../src";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const SCHEMA_PATH = path.join(REPO_ROOT, "schemas/architecture.schema.json");
export const FIXTURES_DIR = path.join(REPO_ROOT, "schemas/fixtures");

export function serializeSchema(): string {
  return `${JSON.stringify(toJsonSchema(), null, 2)}\n`;
}
