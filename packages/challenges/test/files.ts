import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadChallenge, type LoadChallengeResult, toChallengeJsonSchema } from "../src";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const CONTENT_DIR = path.join(REPO_ROOT, "content/challenges");
export const SCHEMA_PATH = path.join(REPO_ROOT, "schemas/challenge.schema.json");

export function serializeSchema(): string {
  return `${JSON.stringify(toChallengeJsonSchema(), null, 2)}\n`;
}

/** Loads a challenge folder from disk the way the CI content check does, with its reference solutions. */
export function loadChallengeDir(dir: string): LoadChallengeResult {
  const read = (name: string) => {
    const file = path.join(dir, name);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  };
  const solutionsDir = path.join(dir, "solutions");
  const solutions = existsSync(solutionsDir)
    ? Object.fromEntries(
        readdirSync(solutionsDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => [
            f.replace(/\.json$/, ""),
            JSON.parse(readFileSync(path.join(solutionsDir, f), "utf8")) as unknown,
          ]),
      )
    : {};
  return loadChallenge(JSON.parse(read("challenge.json") ?? "null"), read, { solutions });
}
