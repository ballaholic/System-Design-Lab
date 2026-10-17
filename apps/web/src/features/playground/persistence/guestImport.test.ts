import { createEmptyDocument } from "@sdl/architecture";
import { architecturesApi } from "@/lib/api/architectures";
import {
  getGuestDesign,
  importedServerId,
  importKeyOf,
  listGuestDesigns,
  newGuestId,
  saveGuestDesign,
} from "./guestDesigns";
import { importGuestDesigns } from "./guestImport";
import { CHALLENGES } from "@/features/challenges/content";
import {
  attemptImportKey,
  createGuestAttempt,
  getGuestAttempt,
  importedAttemptId,
  listGuestAttempts,
} from "@/features/challenges/attempts/guestAttempts";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function mockImport() {
  return vi.spyOn(architecturesApi, "import").mockImplementation(async (designs, attempts = []) => ({
    results: designs.map((d) => ({ importKey: d.importKey, id: `server-${d.importKey}`, created: true })),
    attemptResults: attempts.map((a) => ({
      importKey: a.importKey,
      id: `attempt-${a.importKey}`,
      created: true,
    })),
  }));
}

describe("importGuestDesigns", () => {
  it("does nothing without guest designs", async () => {
    const spy = mockImport();
    await expect(importGuestDesigns()).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("imports with UUID keys, then removes designs from the browser and remembers their new ids", async () => {
    const spy = mockImport();
    const id = newGuestId();
    saveGuestDesign(id, "My design", createEmptyDocument());

    await expect(importGuestDesigns()).resolves.toEqual({ imported: 1, skipped: 0, attempts: 0 });
    expect(spy).toHaveBeenCalledWith(
      [{ importKey: importKeyOf(id), title: "My design", document: createEmptyDocument() }],
      [],
    );
    expect(listGuestDesigns()).toEqual([]);
    expect(importedServerId(id)).toBe(`server-${importKeyOf(id)}`);
  });

  it("shares one request when triggered twice at once", async () => {
    const spy = mockImport();
    saveGuestDesign(newGuestId(), "D", createEmptyDocument());
    const [a, b] = await Promise.all([importGuestDesigns(), importGuestDesigns()]);
    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends batches of at most 10", async () => {
    const spy = mockImport();
    // The guest limit is 10, but older storage could hold more; batching must still hold.
    const ids = Array.from({ length: 10 }, () => newGuestId());
    for (const id of ids) saveGuestDesign(id, "D", createEmptyDocument());
    await importGuestDesigns();
    expect(spy.mock.calls.every(([designs]) => designs.length <= 10)).toBe(true);
  });

  it("skips unreadable designs and keeps them", async () => {
    mockImport();
    const bad = newGuestId();
    saveGuestDesign(bad, "Broken", createEmptyDocument());
    localStorage.setItem(`sdl-guest-design:v1:${bad}`, JSON.stringify({ schemaVersion: 99 }));
    const good = newGuestId();
    saveGuestDesign(good, "Fine", createEmptyDocument());

    await expect(importGuestDesigns()).resolves.toEqual({ imported: 1, skipped: 1, attempts: 0 });
    expect(getGuestDesign(bad)).not.toBeNull();
    expect(getGuestDesign(good)).toBeNull();
  });

  it("moves challenge attempts with their designs, linked by the design's import key", async () => {
    const spy = mockImport();
    const challenge = CHALLENGES[0]!;
    const designId = newGuestId();
    saveGuestDesign(designId, challenge.title, createEmptyDocument(), challenge.slug);
    const attempt = createGuestAttempt(challenge, designId);
    const abandoned = createGuestAttempt(challenge, designId); // abandons the first one
    expect(getGuestAttempt(attempt.id)!.status).toBe("abandoned");

    await expect(importGuestDesigns()).resolves.toEqual({ imported: 1, skipped: 0, attempts: 1 });
    const [designs, attempts] = spy.mock.calls[0]!;
    expect(designs[0]).toMatchObject({ importKey: importKeyOf(designId), challengeSlug: challenge.slug });
    expect(attempts).toEqual([
      expect.objectContaining({
        importKey: attemptImportKey(abandoned.id),
        challengeSlug: challenge.slug,
        status: "in_progress",
        architectureImportKey: importKeyOf(designId),
      }),
    ]);
    expect(importedAttemptId(abandoned.id)).toBe(`attempt-${attemptImportKey(abandoned.id)}`);
    // Imported attempts leave the browser; the abandoned one isn't worth importing and stays.
    expect(listGuestAttempts().map((a) => a.id)).toEqual([attempt.id]);
  });

  it("imports attempts even when their design is gone", async () => {
    const spy = mockImport();
    createGuestAttempt(CHALLENGES[0]!, newGuestId());
    await expect(importGuestDesigns()).resolves.toMatchObject({ imported: 0, attempts: 1 });
    expect(spy.mock.calls[0]![0]).toEqual([]);
  });

  it("keeps designs when the server fails, so a retry can import them", async () => {
    vi.spyOn(architecturesApi, "import").mockRejectedValue(new Error("offline"));
    const id = newGuestId();
    saveGuestDesign(id, "D", createEmptyDocument());
    await expect(importGuestDesigns()).rejects.toThrow("offline");
    expect(getGuestDesign(id)).not.toBeNull();
  });
});
