import { CHALLENGES } from "../content";
import {
  attemptImportKey,
  createGuestAttempt,
  getGuestAttempt,
  importedAttemptId,
  isGuestAttemptId,
  listGuestAttempts,
  rememberImportedAttempts,
  removeGuestAttempts,
  updateGuestAttempt,
} from "./guestAttempts";

const challenge = CHALLENGES[0]!;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("guest attempts", () => {
  it("start at the first stage, linked to a guest design", () => {
    const a = createGuestAttempt(challenge, "local-design", new Date("2026-10-17T10:00:00Z"));
    expect(isGuestAttemptId(a.id)).toBe(true);
    expect(attemptImportKey(a.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).toMatchObject({
      challengeSlug: "url-shortener",
      challengeVersion: challenge.version,
      status: "in_progress",
      currentStageId: "s1-baseline",
      architectureId: "local-design",
      startedAt: "2026-10-17T10:00:00.000Z",
    });
    expect(getGuestAttempt(a.id)).toEqual(a);
  });

  it("keep at most one attempt per challenge in progress", () => {
    const first = createGuestAttempt(challenge, "d1");
    const second = createGuestAttempt(challenge, "d2");
    expect(getGuestAttempt(first.id)!.status).toBe("abandoned");
    expect(
      listGuestAttempts()
        .filter((a) => a.status === "in_progress")
        .map((a) => a.id),
    ).toEqual([second.id]);
  });

  it("apply updates, bump activity and stamp completion", () => {
    const a = createGuestAttempt(challenge, "d", new Date("2026-10-17T10:00:00Z"));
    const later = new Date("2026-10-17T11:00:00Z");
    updateGuestAttempt(a.id, { hintsRevealed: ["s1-path"] }, later);
    const done = updateGuestAttempt(a.id, { status: "completed" }, later)!;
    expect(done).toMatchObject({
      hintsRevealed: ["s1-path"],
      status: "completed",
      lastActivityAt: "2026-10-17T11:00:00.000Z",
      completedAt: "2026-10-17T11:00:00.000Z",
    });
    expect(updateGuestAttempt("local-attempt-missing", {})).toBeNull();
  });

  it("are removed after import and remembered for redirects", () => {
    const a = createGuestAttempt(challenge, "d");
    rememberImportedAttempts({ [a.id]: "server-1" });
    removeGuestAttempts([a.id]);
    expect(listGuestAttempts()).toEqual([]);
    expect(importedAttemptId(a.id)).toBe("server-1");
    expect(importedAttemptId("local-attempt-other")).toBeNull();
  });

  it("survive unreadable storage", () => {
    localStorage.setItem("sdl-guest-attempts:v1", "{not json");
    expect(listGuestAttempts()).toEqual([]);
  });
});
