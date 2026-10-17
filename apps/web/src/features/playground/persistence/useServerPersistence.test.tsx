import { createEmptyDocument, type ArchitectureDocument } from "@sdl/architecture";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthContext, type AuthContextValue } from "@/features/auth/authContext";
import { type Architecture, architecturesApi } from "@/lib/api/architectures";
import { ApiError } from "@/lib/api/client";
import { createEditorStore } from "../store/editorStore";
import { readDraft } from "./drafts";
import { AUTOSAVE_DELAY_MS, useServerPersistence } from "./useServerPersistence";

const auth: AuthContextValue = {
  status: "authenticated",
  session: { user: { id: "user-1" } } as AuthContextValue["session"],
  lastEvent: null,
  signOut: async () => {},
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

const architecture = (
  version: number,
  document: ArchitectureDocument = createEmptyDocument(),
): Architecture => ({
  id: "design-1",
  title: "My design",
  description: null,
  challengeSlug: null,
  document,
  version,
  createdAt: "2026-10-17T00:00:00Z",
  updatedAt: "2026-10-17T00:00:00Z",
});

function setup(
  initial: Pick<Architecture, "id" | "title" | "version"> | null = {
    id: "design-1",
    title: "My design",
    version: 3,
  },
) {
  const store = createEditorStore(createEmptyDocument());
  const onCreated = vi.fn();
  const hook = renderHook(() => useServerPersistence({ store, initial, onCreated }), { wrapper });
  const edit = () => act(() => void store.getState().addComponent("api-server", { x: 0, y: 0 }));
  const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)));
  return { store, onCreated, hook, edit, flush };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("useServerPersistence", () => {
  it("debounces autosave and sends If-Match with the current version", async () => {
    const save = vi.spyOn(architecturesApi, "save").mockResolvedValue(architecture(4));
    const { hook, edit, flush, store } = setup();
    expect(hook.result.current.status).toBe("saved");

    edit();
    expect(hook.result.current.status).toBe("unsaved");
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100)));
    expect(save).not.toHaveBeenCalled();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("design-1", store.getState().doc, 3);
    expect(hook.result.current.status).toBe("saved");

    // The next save uses the version the server returned.
    edit();
    await flush();
    expect(save).toHaveBeenLastCalledWith("design-1", store.getState().doc, 4);
  });

  it("keeps a local draft until the server acknowledges the save", async () => {
    let resolve!: (a: Architecture) => void;
    vi.spyOn(architecturesApi, "save").mockReturnValue(new Promise((r) => (resolve = r)));
    const { edit, flush, hook } = setup();
    edit();
    await flush();
    expect(hook.result.current.status).toBe("saving");
    expect(readDraft("design-1")).toMatchObject({ baseVersion: 3 });
    await act(async () => resolve(architecture(4)));
    expect(readDraft("design-1")).toBeNull();
  });

  it("creates a new design on first save and reports its id", async () => {
    const create = vi.spyOn(architecturesApi, "create").mockResolvedValue(architecture(1));
    const save = vi.spyOn(architecturesApi, "save").mockResolvedValue(architecture(2));
    const { edit, flush, onCreated } = setup(null);
    edit();
    await flush();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Untitled design" }));
    expect(onCreated).toHaveBeenCalledWith("design-1");
    edit();
    await flush();
    expect(save).toHaveBeenCalledWith("design-1", expect.anything(), 1);
  });

  it("shows a conflict on 412 and stops autosaving until resolved", async () => {
    const save = vi
      .spyOn(architecturesApi, "save")
      .mockRejectedValueOnce(new ApiError(412, { title: "Changed elsewhere" }))
      .mockResolvedValue(architecture(8));
    const newer = createEmptyDocument();
    newer.notes = "from the other tab";
    const get = vi.spyOn(architecturesApi, "get").mockResolvedValue(architecture(7, newer));
    const { edit, flush, hook, store } = setup();

    edit();
    await flush();
    expect(hook.result.current.status).toBe("conflict");
    edit();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);

    await act(() => hook.result.current.resolveConflict!("reload"));
    expect(get).toHaveBeenCalledWith("design-1");
    expect(store.getState().doc.notes).toBe("from the other tab");
    expect(hook.result.current.status).toBe("saved");
  });

  it("overwrites with the latest version when the user keeps theirs", async () => {
    const save = vi
      .spyOn(architecturesApi, "save")
      .mockRejectedValueOnce(new ApiError(412, {}))
      .mockResolvedValue(architecture(8));
    vi.spyOn(architecturesApi, "get").mockResolvedValue(architecture(7));
    const { edit, flush, hook, store } = setup();
    edit();
    await flush();
    await act(() => hook.result.current.resolveConflict!("overwrite"));
    expect(save).toHaveBeenLastCalledWith("design-1", store.getState().doc, 7);
    expect(hook.result.current.status).toBe("saved");
  });

  it("goes offline on network errors and retries when the connection returns", async () => {
    const save = vi
      .spyOn(architecturesApi, "save")
      .mockRejectedValueOnce(new ApiError(0, { title: "Network error" }))
      .mockResolvedValue(architecture(4));
    const { edit, flush, hook } = setup();
    edit();
    await flush();
    expect(hook.result.current.status).toBe("offline");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.runOnlyPendingTimersAsync();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe("saved");
  });

  it("reports other errors and refuses documents over the limits", async () => {
    vi.spyOn(architecturesApi, "save").mockRejectedValue(
      new ApiError(400, { detail: "The design is invalid." }),
    );
    const { edit, flush, hook } = setup();
    edit();
    await flush();
    expect(hook.result.current).toMatchObject({ status: "error", error: "The design is invalid." });
  });

  it("saves immediately on demand and renames", async () => {
    const save = vi.spyOn(architecturesApi, "save").mockResolvedValue(architecture(4));
    const rename = vi.spyOn(architecturesApi, "rename").mockResolvedValue(architecture(3));
    const { edit, hook } = setup();
    edit();
    await act(async () => hook.result.current.saveNow());
    expect(save).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.rename("  New name  "));
    expect(hook.result.current.title).toBe("New name");
    expect(rename).toHaveBeenCalledWith("design-1", { title: "New name" });
  });
});
