// The CI content check: every challenge in content/challenges must load, and its reference solutions must pass
// their stages. A deliberately broken fixture proves the check fails.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadChallenge } from "../src";
import { CONTENT_DIR, loadChallengeDir, SCHEMA_PATH, serializeSchema } from "./files";

const challenges = readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe("challenge content", () => {
  it("has at least the URL Shortener", () => {
    expect(challenges).toContain("url-shortener");
  });

  it.each(challenges)("%s is valid, and each stage is solvable but not passed by the starter", (slug) => {
    const result = loadChallengeDir(path.join(CONTENT_DIR, slug));
    if (!result.ok) throw new Error(result.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
    expect(result.challenge.slug).toBe(slug);
    expect(result.challenge.stages.every((s) => s.briefMd.length > 0)).toBe(true);
  });

  it("rejects a broken challenge with a precise reason for each problem", () => {
    const result = loadChallengeDir(path.join(import.meta.dirname, "fixtures/broken-references"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { path: "stages[0].brief", message: 'Missing file "missing.md".' },
        { path: "stages[1]", message: 'Duplicate stage id "only".' },
        {
          path: "stages[0].criteria[0]",
          message: 'Refers to exercise "nope", which isn\'t in this or an earlier stage.',
        },
        {
          path: "stages[0].criteria[1]",
          message: 'Refers to operation "ghost", which the starter design doesn\'t define.',
        },
      ]),
    );
  });

  it("rejects a definition that doesn't match the schema", () => {
    const result = loadChallenge({ schemaVersion: 1, slug: "Bad Slug!" }, () => undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.path)).toContain("slug");
  });

  it("checks the starter design and the reference solutions", () => {
    const dir = path.join(CONTENT_DIR, "url-shortener");
    const def = JSON.parse(readFileSync(path.join(dir, "challenge.json"), "utf8")) as Record<string, unknown>;
    const read = (name: string) =>
      existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : undefined;
    const starterless = loadChallenge(def, (n) => (n === "starter.json" ? "{not json" : read(n)));
    expect(starterless.ok).toBe(false);
    if (!starterless.ok)
      expect(starterless.issues).toContainEqual({ path: "starter.json", message: "Not valid JSON." });

    const unsolved = loadChallenge(def, read, {
      solutions: { "s1-baseline": JSON.parse(read("starter.json")!) },
    });
    expect(unsolved.ok).toBe(false);
    if (!unsolved.ok) {
      const paths = unsolved.issues.map((i) => i.path);
      expect(paths).toContain("solutions/s1-baseline.json");
      expect(paths).toContain("solutions/s2-viral.json");
    }
  });

  it("keeps the committed JSON Schema in step with the Zod schema", () => {
    expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(serializeSchema());
  });
});
