import { type Challenge, loadChallenge } from "@sdl/challenges";

// Challenge content is bundled from content/challenges (ADR-008): the same files the API loads and serves.
// Bundling lets guests play offline and keeps the workspace free of loading states. Reference solutions
// are for the content check only and aren't included.

const definitions = import.meta.glob<unknown>("../../../../../content/challenges/*/challenge.json", {
  eager: true,
  import: "default",
});
const files = import.meta.glob<string>(
  ["../../../../../content/challenges/*/*.md", "../../../../../content/challenges/*/starter.json"],
  { eager: true, query: "?raw", import: "default" },
);

function folderOf(path: string): string {
  return path.split("/").at(-2)!;
}

function load(): Challenge[] {
  const challenges: Challenge[] = [];
  for (const [path, raw] of Object.entries(definitions)) {
    const folder = folderOf(path);
    const read = (name: string) => files[`../../../../../content/challenges/${folder}/${name}`];
    const result = loadChallenge(raw, read);
    // The CI content check guarantees valid content; an invalid file in development is a bug to see at once.
    if (!result.ok) {
      throw new Error(
        `Invalid challenge "${folder}": ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
      );
    }
    challenges.push(result.challenge);
  }
  return challenges.sort((a, b) => a.order - b.order);
}

export const CHALLENGES: readonly Challenge[] = load();

export function findChallenge(slug: string | undefined): Challenge | undefined {
  return CHALLENGES.find((c) => c.slug === slug);
}

export const DIFFICULTY_LABEL: Record<Challenge["difficulty"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** "load-balancing" → "Load balancing". */
export function topicLabel(topic: string): string {
  const text = topic.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
