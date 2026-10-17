import type { ArchitectureDocument } from "@sdl/architecture";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { MemoryRouter } from "react-router";
import { ThemeContext } from "@/app/themeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Persistence } from "../persistence/saveStatus";
import { PlaygroundEditor } from "../PlaygroundEditor";
import { EditorStoreContext } from "../store/editorContext";
import { createEditorStore } from "../store/editorStore";
import { urlShortenerDesign } from "../test/designs";

function setup(doc: ArchitectureDocument = urlShortenerDesign()) {
  const store = createEditorStore(doc);
  const persistence: Persistence = {
    status: "saved",
    target: "browser",
    error: null,
    title: "URL shortener",
    rename: vi.fn(),
    saveNow: vi.fn(),
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
  return { s: () => store.getState() };
}

const panel = () => screen.getByRole("region", { name: "Simulation" });

async function openSimulation() {
  await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
  return panel();
}

describe("simulation panel", () => {
  it("simulates the design live and saves the traffic with it", async () => {
    const { s } = setup();
    const p = await openSimulation();
    expect(within(p).getByText("1,000 of 1,000 requests/s")).toBeInTheDocument();
    expect(within(p).getByText(/Engine v\d/)).toBeInTheDocument();
    expect(within(p).getByRole("link", { name: /How the simulator works/ })).toHaveAttribute(
      "href",
      "/docs/simulator",
    );

    const rps = within(p).getByLabelText("Total traffic (requests/s)");
    await userEvent.clear(rps);
    await userEvent.type(rps, "11000");
    expect(s().doc.traffic).toEqual({ totalRps: 11_000 });
    expect(await within(p).findByText("6,000 of 11,000 requests/s")).toBeInTheDocument();
    const bottlenecks = within(p).getByRole("region", { name: "Bottlenecks" });
    expect(within(bottlenecks).getAllByRole("listitem")[0]).toHaveTextContent("PostgreSQL reads200%");
  });

  it("moves the read share with a mix override and can reset it", async () => {
    const { s } = setup();
    const p = await openSimulation();
    const slider = within(p).getByRole("slider");
    expect(slider).toHaveValue("91");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(s().doc.traffic?.mix).toEqual({ redirect: 0, create: 1 });
    await userEvent.click(within(p).getByRole("button", { name: "Reset to the operation shares" }));
    expect(s().doc.traffic?.mix).toBeUndefined();
  });

  it("in Run mode keeps the last result until run again, and says when it's out of date", async () => {
    const { s } = setup();
    const p = await openSimulation();
    await userEvent.click(within(p).getByRole("switch", { name: "Live" }));
    expect(within(p).getByText("1,000 of 1,000 requests/s")).toBeInTheDocument();

    s().setTraffic({ totalRps: 2000 });
    expect(await within(p).findByText(/The design changed since this run/)).toBeInTheDocument();
    expect(within(p).getByText("1,000 of 1,000 requests/s")).toBeInTheDocument();
    await userEvent.click(within(p).getByRole("button", { name: "Run" }));
    expect(within(p).getByText("2,000 of 2,000 requests/s")).toBeInTheDocument();
    expect(within(p).queryByText(/The design changed/)).not.toBeInTheDocument();
  });

  it("explains what blocks an invalid design and links to the issues", async () => {
    const doc = urlShortenerDesign();
    doc.edges.push({ id: "db-client", source: "db", target: "client" });
    setup(doc);
    const p = await openSimulation();
    expect(within(p).getByRole("status")).toHaveTextContent("1 problem blocks the simulation");
    await userEvent.click(within(p).getByRole("button", { name: "Show issues" }));
    expect(screen.getByRole("tab", { name: /Issues/, selected: true })).toBeInTheDocument();
  });

  it("injects failures from the inspector and shows them as removable chips", async () => {
    const { s } = setup();
    s().setSelection({ nodeIds: ["db"], edgeIds: [] });
    const p = await openSimulation();
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    await userEvent.click(within(inspector).getByRole("switch", { name: "Primary down" }));
    expect(s().scenario.failures).toEqual([{ kind: "database-primary-down", nodeId: "db" }]);

    const chips = await within(p).findByRole("list", { name: "Injected failures" });
    expect(chips).toHaveTextContent('"PostgreSQL" is down');
    expect(await within(p).findByText("0 of 1,000 requests/s")).toBeInTheDocument();
    expect(within(inspector).getByRole("region", { name: "Simulated load" })).toHaveTextContent("Down");

    await userEvent.click(within(chips).getByRole("button", { name: /Remove failure/ }));
    expect(s().scenario.failures).toEqual([]);
  });

  it("sets how many instances fail", async () => {
    const { s } = setup();
    s().setSelection({ nodeIds: ["api"], edgeIds: [] });
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    await userEvent.click(await within(inspector).findByRole("switch", { name: "Instances fail" }));
    const count = within(inspector).getByLabelText("Failed instances");
    await userEvent.clear(count);
    await userEvent.type(count, "6");
    expect(s().scenario.failures).toEqual([{ kind: "app-instance-failure", nodeId: "api", count: 6 }]);
  });

  it("shows components, events and the sweep", async () => {
    setup({ ...urlShortenerDesign(), traffic: { totalRps: 11_000 } });
    const p = await openSimulation();

    await userEvent.click(within(p).getByRole("tab", { name: "Components" }));
    const table = within(p).getByRole("table", { name: "Simulation results per component" });
    const dbRow = within(table)
      .getAllByRole("row")
      .find((r) => r.textContent?.includes("PostgreSQL"))!;
    expect(dbRow).toHaveTextContent("Saturated");
    expect(dbRow).toHaveTextContent("reads 200%");

    await userEvent.click(within(p).getByRole("tab", { name: /Events/ }));
    expect(
      within(p).getByText(/"PostgreSQL" \(reads\) is saturated at 200% of capacity\./),
    ).toBeInTheDocument();

    await userEvent.click(within(p).getByRole("tab", { name: "Sweep" }));
    expect(within(p).getByRole("img", { name: "Success rate by total traffic" })).toBeInTheDocument();
    expect(within(p).getByText(/Breaks at/)).toHaveTextContent("Breaks at 5,500 requests/s.");
  });

  it("celebrates when a failing design gets every request through, once per fix", async () => {
    const { s } = setup({ ...urlShortenerDesign(), traffic: { totalRps: 11_000 } });
    const p = await openSimulation();
    expect(within(p).queryByText("All requests succeed")).not.toBeInTheDocument();
    s().setNodeConfig("db", "readCapacity", 20_000);
    expect(await within(p).findByText("All requests succeed")).toBeInTheDocument();
    // Closing and reopening doesn't replay it.
    await userEvent.click(within(p).getByRole("button", { name: "Close simulation" }));
    const reopened = await openSimulation();
    expect(within(reopened).queryByText("All requests succeed")).not.toBeInTheDocument();
  });

  it("closes from the panel", async () => {
    setup();
    const p = await openSimulation();
    await userEvent.click(within(p).getByRole("button", { name: "Close simulation" }));
    expect(screen.queryByRole("region", { name: "Simulation" })).not.toBeInTheDocument();
  });
});
