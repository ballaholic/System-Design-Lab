import { createEmptyDocument } from "@sdl/architecture";
import {
  deleteGuestDesign,
  duplicateGuestDesign,
  getGuestDesign,
  GUEST_DESIGN_LIMIT,
  importedServerId,
  importKeyOf,
  isGuestId,
  listGuestDesigns,
  newGuestId,
  rememberImported,
  renameGuestDesign,
  saveGuestDesign,
} from "./guestDesigns";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("guest designs", () => {
  it("saves, lists newest first, reads, renames and deletes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
    const a = newGuestId();
    expect(saveGuestDesign(a, "First", createEmptyDocument())).toEqual({ ok: true });
    vi.setSystemTime(new Date("2026-10-17T11:00:00Z"));
    const b = newGuestId();
    saveGuestDesign(b, "Second", createEmptyDocument());
    vi.useRealTimers();

    expect(listGuestDesigns().map((d) => d.title)).toEqual(["Second", "First"]);
    expect(getGuestDesign(a)).toMatchObject({
      id: a,
      title: "First",
      nodeCount: 0,
      document: createEmptyDocument(),
    });
    renameGuestDesign(a, "Renamed");
    expect(getGuestDesign(a)?.title).toBe("Renamed");
    deleteGuestDesign(a);
    expect(getGuestDesign(a)).toBeNull();
    expect(localStorage.length).toBe(2); // index + one design
  });

  it("keeps createdAt when saving again", () => {
    const id = newGuestId();
    saveGuestDesign(id, "Doc", createEmptyDocument());
    const created = getGuestDesign(id)!.createdAt;
    saveGuestDesign(id, "Doc", createEmptyDocument());
    expect(getGuestDesign(id)!.createdAt).toBe(created);
  });

  it(`refuses an eleventh design but still updates existing ones`, () => {
    const ids = Array.from({ length: GUEST_DESIGN_LIMIT }, () => newGuestId());
    for (const id of ids) expect(saveGuestDesign(id, "D", createEmptyDocument()).ok).toBe(true);
    expect(saveGuestDesign(newGuestId(), "Too many", createEmptyDocument())).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(saveGuestDesign(ids[0]!, "Updated", createEmptyDocument())).toEqual({ ok: true });
    expect(duplicateGuestDesign(ids[0]!)).toBeNull();
  });

  it("duplicates under a new id", () => {
    const id = newGuestId();
    saveGuestDesign(id, "Original", createEmptyDocument());
    const copy = duplicateGuestDesign(id)!;
    expect(copy).not.toBe(id);
    expect(getGuestDesign(copy)?.title).toBe("Copy of Original");
    expect(duplicateGuestDesign("local-missing")).toBeNull();
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("sdl-guest-designs:v1", "{not json");
    expect(listGuestDesigns()).toEqual([]);
    localStorage.setItem("sdl-guest-designs:v1", JSON.stringify({ not: "an array" }));
    expect(listGuestDesigns()).toEqual([]);
  });

  it("reports storage failures", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(saveGuestDesign(newGuestId(), "D", createEmptyDocument())).toEqual({
      ok: false,
      reason: "storage",
    });
    spy.mockRestore();
  });

  it("ids and import keys", () => {
    const id = newGuestId();
    expect(isGuestId(id)).toBe(true);
    expect(isGuestId("0190a4d2-1234")).toBe(false);
    expect(isGuestId(undefined)).toBe(false);
    expect(importKeyOf(id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("remembers where imported designs went", () => {
    expect(importedServerId("local-x")).toBeNull();
    rememberImported({ "local-x": "server-1" });
    rememberImported({ "local-y": "server-2" });
    expect(importedServerId("local-x")).toBe("server-1");
    expect(importedServerId("local-y")).toBe("server-2");
  });
});
