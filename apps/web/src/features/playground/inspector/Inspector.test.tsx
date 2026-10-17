import { flowsOf } from "@sdl/architecture";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderEditor } from "../test/renderEditor";
import { Inspector } from "./Inspector";

function setupWithApi() {
  const utils = renderEditor(<Inspector />);
  let ids = { api: "", db: "", cache: "" };
  act(() => {
    const api = utils.s().addComponent("api-server", { x: 0, y: 0 });
    const db = utils.s().addComponent("sql-database", { x: 300, y: 0 });
    const cache = utils.s().addComponent("redis-cache", { x: 300, y: 200 });
    if (!api.ok || !db.ok || !cache.ok) throw new Error();
    ids = { api: api.value, db: db.value, cache: cache.value };
    utils.s().connect(api.value, db.value);
    utils.s().connect(api.value, cache.value);
    utils.s().setSelection({ nodeIds: [api.value], edgeIds: [] });
  });
  return { ...utils, ids };
}

describe("Inspector", () => {
  it("shows operations and notes when nothing is selected", async () => {
    const { s } = renderEditor(<Inspector />);
    expect(screen.getByText("Operations")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Design notes"), "Read heavy");
    expect(s().doc.notes).toBe("Read heavy");
    await userEvent.click(screen.getByRole("button", { name: /Add operation/ }));
    expect(s().doc.operations).toHaveLength(3);
  });

  it("edits config from the catalog with units, help and validation", async () => {
    const { s, ids } = setupWithApi();
    const instances = screen.getByLabelText("Instances");
    await userEvent.clear(instances);
    await userEvent.type(instances, "6");
    expect(s().doc.nodes.find((n) => n.id === ids.api)!.config).toMatchObject({ instances: 6 });

    await userEvent.clear(instances);
    await userEvent.type(instances, "0");
    expect(screen.getByText(/Enter a whole number from 1 to 1,000/)).toBeInTheDocument();
    expect(s().doc.nodes.find((n) => n.id === ids.api)!.config).toMatchObject({ instances: 6 });

    // Leaving an invalid value restores the stored one.
    await userEvent.tab();
    expect(instances).toHaveValue("6");
    expect(screen.getByText("Requests per second one instance can handle.")).toBeInTheDocument();
  });

  it("follows undo in fields", async () => {
    const { s, ids } = setupWithApi();
    act(() => s().setNodeConfig(ids.api, "instances", 9));
    expect(screen.getByLabelText("Instances")).toHaveValue("9");
    act(() => s().undo());
    expect(screen.getByLabelText("Instances")).toHaveValue("2");
  });

  it("edits ratios as percentages", async () => {
    const { s, ids } = setupWithApi();
    act(() => s().setSelection({ nodeIds: [ids.cache], edgeIds: [] }));
    const hitRate = screen.getByLabelText("Hit rate");
    expect(hitRate).toHaveValue("80");
    await userEvent.clear(hitRate);
    await userEvent.type(hitRate, "95");
    expect(s().doc.nodes.find((n) => n.id === ids.cache)!.config).toMatchObject({ hitRate: 0.95 });
  });

  it("builds a flow: handle an operation, add steps, nest on-miss steps, reorder and remove", async () => {
    const { s, ids } = setupWithApi();
    const api = () => s().doc.nodes.find((n) => n.id === ids.api)!;
    const dbEdge = s().doc.edges.find((e) => e.target === ids.db)!.id;
    const cacheEdge = s().doc.edges.find((e) => e.target === ids.cache)!.id;

    const handleButtons = screen.getAllByRole("button", { name: "Handle" });
    await userEvent.click(handleButtons[0]!);
    expect(flowsOf(api()).read).toEqual([]);

    const readFlow = () => screen.getByRole("region", { name: "Read flow" });
    await userEvent.click(within(readFlow()).getByRole("button", { name: /Add step/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Look up in Cache/ }));
    expect(flowsOf(api()).read).toEqual([
      { type: "cache-lookup", edge: cacheEdge, onMiss: [], populate: true },
    ]);

    await userEvent.click(within(readFlow()).getByRole("button", { name: /Add on-miss step/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Call SQL database/ }));
    expect(flowsOf(api()).read).toEqual([
      { type: "cache-lookup", edge: cacheEdge, onMiss: [{ type: "call", edge: dbEdge }], populate: true },
    ]);

    await userEvent.click(within(readFlow()).getAllByRole("button", { name: /^Add step/ })[0]!);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Write to Cache/ }));
    await userEvent.click(within(readFlow()).getByRole("button", { name: 'Move "Write to Cache" up' }));
    expect(flowsOf(api()).read![0]).toMatchObject({ type: "call", as: "write" });
    await userEvent.click(within(readFlow()).getByRole("button", { name: 'Remove "Write to Cache"' }));
    expect(flowsOf(api()).read).toHaveLength(1);

    await userEvent.click(within(readFlow()).getByRole("button", { name: "Stop handling Read" }));
    expect(flowsOf(api())).not.toHaveProperty("read");
  });

  it("connects by keyboard and explains refused connections", async () => {
    const { s, ids } = setupWithApi();
    act(() => s().setSelection({ nodeIds: [ids.db], edgeIds: [] }));
    // Stores don't start connections, so there's no "Connect to" control.
    expect(screen.queryByLabelText("Connect to…")).not.toBeInTheDocument();
    act(() => void s().addComponent("load-balancer", { x: 0, y: 0 }));
    const lb = s().selection.nodeIds[0]!;
    await userEvent.click(screen.getByLabelText("Connect to…"));
    const options = await screen.findAllByRole("option");
    expect(options.find((o) => o.textContent?.includes("SQL database"))).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(options.find((o) => o.textContent === "API server")!);
    expect(s().doc.edges.some((e) => e.source === lb && e.target === ids.api)).toBe(true);
  });

  it("offers suggested steps for a new connection and applies one", async () => {
    const { s, ids } = setupWithApi();
    const cacheEdge = s().doc.edges.find((e) => e.target === ids.cache)!.id;
    act(() => s().setSelection({ nodeIds: [], edgeIds: [cacheEdge] }));
    expect(screen.getByText(/Carries no traffic yet/)).toBeInTheDocument();
    const suggestions = screen.getByText("Suggested steps").closest("section")!;
    await userEvent.click(within(suggestions).getAllByRole("button", { name: "Add" })[0]!);
    expect(flowsOf(s().doc.nodes.find((n) => n.id === ids.api)!).read).toEqual([
      { type: "cache-lookup", edge: cacheEdge, populate: true, onMiss: [] },
    ]);
    expect(screen.getByText("Carries Read.")).toBeInTheDocument();
  });

  it("delegates delete and duplicate to the page", async () => {
    const { actions } = setupWithApi();
    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.duplicate).toHaveBeenCalled();
    expect(actions.requestDelete).toHaveBeenCalled();
  });
});
