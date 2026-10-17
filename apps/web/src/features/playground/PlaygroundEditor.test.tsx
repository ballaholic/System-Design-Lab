import { createEmptyDocument } from "@sdl/architecture";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { MemoryRouter } from "react-router";
import { ThemeContext } from "@/app/themeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Persistence } from "./persistence/saveStatus";
import { PlaygroundEditor } from "./PlaygroundEditor";
import { EditorStoreContext } from "./store/editorContext";
import { createEditorStore } from "./store/editorStore";

function setup(overrides: Partial<Persistence> = {}) {
  const store = createEditorStore(createEmptyDocument());
  const persistence: Persistence = {
    status: "saved",
    target: "browser",
    error: null,
    title: "Untitled design",
    rename: vi.fn(),
    saveNow: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <ThemeContext.Provider value={{ theme: "dark", resolvedTheme: "dark", setTheme: () => {} }}>
        <EditorStoreContext.Provider value={store}>
          <ReactFlowProvider>
            <TooltipProvider>
              <PlaygroundEditor persistence={persistence} />
            </TooltipProvider>
          </ReactFlowProvider>
        </EditorStoreContext.Provider>
      </ThemeContext.Provider>
    </MemoryRouter>,
  );
  return { store, s: () => store.getState(), persistence };
}

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

describe("PlaygroundEditor", () => {
  it("adds components from the library with the keyboard", async () => {
    const { s } = setup();
    const library = screen.getByRole("complementary", { name: "Components" });
    const button = within(library).getByRole("button", { name: "Load balancer" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(s().doc.nodes.map((n) => n.type)).toEqual(["load-balancer"]);
    expect(s().selection.nodeIds).toHaveLength(1);
  });

  it("filters the library by search", async () => {
    setup();
    const library = screen.getByRole("complementary", { name: "Components" });
    await userEvent.type(within(library).getByLabelText("Search components"), "kafka");
    expect(within(library).getByRole("button", { name: "Event stream" })).toBeInTheDocument();
    expect(within(library).queryByRole("button", { name: "Load balancer" })).not.toBeInTheDocument();
  });

  it("supports undo, redo, duplicate and delete shortcuts", () => {
    const { s } = setup();
    act(() => void s().addComponent("api-server", { x: 0, y: 0 }));
    key("d", { ctrlKey: true });
    expect(s().doc.nodes).toHaveLength(2);
    key("z", { ctrlKey: true });
    expect(s().doc.nodes).toHaveLength(1);
    key("z", { ctrlKey: true, shiftKey: true });
    expect(s().doc.nodes).toHaveLength(2);
    key("z", { ctrlKey: true });
    key("y", { ctrlKey: true });
    expect(s().doc.nodes).toHaveLength(2);
    act(() => s().setSelection({ nodeIds: [s().doc.nodes[1]!.id], edgeIds: [] }));
    key("Delete");
    expect(s().doc.nodes).toHaveLength(1);
    key("Escape");
    expect(s().selection.nodeIds).toEqual([]);
  });

  it("saves on Ctrl+S, even while typing in a field", () => {
    const { persistence } = setup();
    fireEvent.keyDown(screen.getByLabelText("Design title"), { key: "s", ctrlKey: true });
    expect(persistence.saveNow).toHaveBeenCalled();
  });

  it("ignores editing shortcuts while typing", async () => {
    const { s } = setup();
    act(() => void s().addComponent("api-server", { x: 0, y: 0 }));
    fireEvent.keyDown(screen.getByLabelText("Design title"), { key: "Backspace" });
    expect(s().doc.nodes).toHaveLength(1);
  });

  it("asks before deleting a connection that flows use, then removes the steps together", async () => {
    const { s } = setup();
    act(() => {
      const api = s().addComponent("api-server", { x: 0, y: 0 });
      const db = s().addComponent("sql-database", { x: 0, y: 0 });
      if (!api.ok || !db.ok) throw new Error();
      const edge = s().connect(api.value, db.value);
      if (!edge.ok) throw new Error();
      s().setNodeFlow(api.value, "read", [{ type: "call", edge: edge.value }]);
      s().setSelection({ nodeIds: [], edgeIds: [edge.value] });
    });
    key("Delete");
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Read on API server")).toBeInTheDocument();
    expect(s().doc.edges).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(s().doc.edges).toHaveLength(0);
    act(() => s().undo());
    expect(s().doc.edges).toHaveLength(1);
  });

  it("shows the outline view and issue counts", async () => {
    const { s } = setup();
    act(() => void s().addComponent("web-client", { x: 0, y: 0 }));
    expect(screen.getByRole("tab", { name: /Issues/ })).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("tab", { name: /Issues/ }));
    expect(screen.getByText(/isn't connected to anything/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Outline view (text)" }));
    const outline = screen.getByRole("article", { name: "Architecture outline" });
    expect(within(outline).getByText("Web client")).toBeInTheDocument();
    expect(within(outline).getByText(/Connects to nothing/)).toBeInTheDocument();
  });

  it("shows save status and the conflict dialog", async () => {
    const resolveConflict = vi.fn(async () => {});
    setup({ status: "conflict", target: "account", resolveConflict });
    expect(screen.getByRole("status")).toHaveTextContent("Changed elsewhere");
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep mine" }));
    expect(resolveConflict).toHaveBeenCalledWith("overwrite");
  });

  it("offers sign-in to guests instead of a save button", () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Saved in this browser");
    expect(screen.getByRole("link", { name: /Sign in/ })).toHaveAttribute("href", "/login?next=/designs");
  });
});
