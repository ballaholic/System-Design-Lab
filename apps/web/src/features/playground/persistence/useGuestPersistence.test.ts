import { createEmptyDocument } from "@sdl/architecture";
import { act, renderHook } from "@testing-library/react";
import { createEditorStore } from "../store/editorStore";
import { GUEST_DESIGN_LIMIT, getGuestDesign, newGuestId, saveGuestDesign } from "./guestDesigns";
import { GUEST_SAVE_DELAY_MS, useGuestPersistence } from "./useGuestPersistence";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

function setup(initial: { id: string; title: string } | null = null) {
  const store = createEditorStore(createEmptyDocument());
  const onCreated = vi.fn();
  const hook = renderHook(() => useGuestPersistence({ store, initial, onCreated }));
  const edit = () => act(() => void store.getState().addComponent("cdn", { x: 0, y: 0 }));
  const flush = () => act(() => void vi.advanceTimersByTime(GUEST_SAVE_DELAY_MS));
  return { store, hook, onCreated, edit, flush };
}

describe("useGuestPersistence", () => {
  it("creates a guest design on the first edit and autosaves later edits", () => {
    const { hook, onCreated, edit, flush, store } = setup();
    expect(hook.result.current).toMatchObject({ status: "saved", target: "browser" });
    edit();
    expect(hook.result.current.status).toBe("unsaved");
    flush();
    expect(onCreated).toHaveBeenCalledTimes(1);
    const id = onCreated.mock.calls[0]![0] as string;
    expect(getGuestDesign(id)?.document).toEqual(store.getState().doc);
    edit();
    flush();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(getGuestDesign(id)?.nodeCount).toBe(2);
    expect(hook.result.current.status).toBe("saved");
  });

  it("saves pending edits when the editor closes", () => {
    const id = newGuestId();
    const { hook, edit } = setup({ id, title: "Mine" });
    edit();
    hook.unmount();
    expect(getGuestDesign(id)?.nodeCount).toBe(1);
  });

  it("explains when the browser is full", () => {
    for (let i = 0; i < GUEST_DESIGN_LIMIT; i++) saveGuestDesign(newGuestId(), "D", createEmptyDocument());
    const { hook, edit, flush } = setup();
    edit();
    flush();
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error).toContain("sign in");
  });

  it("renames, creating a new design if needed", () => {
    const { hook, onCreated } = setup();
    act(() => hook.result.current.rename("Feed design"));
    expect(hook.result.current.title).toBe("Feed design");
    const id = onCreated.mock.calls[0]![0] as string;
    expect(getGuestDesign(id)?.title).toBe("Feed design");
    act(() => hook.result.current.rename("Feed v2"));
    expect(getGuestDesign(id)?.title).toBe("Feed v2");
  });
});
