import { expect, type Locator, type Page, test } from "@playwright/test";

// Guest-mode playground checks in a real browser (Phase 2 acceptance criteria).

const library = (page: Page) => page.getByRole("complementary", { name: "Components" });
const canvas = (page: Page) => page.locator(".react-flow__pane");
const node = (page: Page, label: string) => page.locator(".react-flow__node").filter({ hasText: label });

async function addByKeyboard(page: Page, name: string) {
  const button = library(page).getByRole("button", { name, exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
}

async function dragOntoCanvas(page: Page, name: string, at: { x: number; y: number }) {
  await library(page).getByRole("button", { name, exact: true }).dragTo(canvas(page), { targetPosition: at });
}

type Side = "top" | "right" | "bottom" | "left";

async function connect(page: Page, from: Locator, to: Locator, sides: [Side, Side] = ["right", "left"]) {
  const source = await from.locator(`.react-flow__handle-${sides[0]}`).boundingBox();
  const target = await to.locator(`.react-flow__handle-${sides[1]}`).boundingBox();
  if (!source || !target) throw new Error("handle not found");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function position(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/playground");
  await expect(canvas(page)).toBeVisible();
});

test("adds components by keyboard and by drag, connects them, and keeps the design after a reload", async ({
  page,
}) => {
  await addByKeyboard(page, "Web client");
  await dragOntoCanvas(page, "Load balancer", { x: 700, y: 200 });
  await dragOntoCanvas(page, "API server", { x: 700, y: 450 });
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  // Spread them out so handles don't overlap, then connect client → LB → API.
  await connect(page, node(page, "Web client"), node(page, "Load balancer"));
  await connect(page, node(page, "Load balancer"), node(page, "API server"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  // The first edit gives the guest design a URL; autosave writes it to this browser.
  await expect(page).toHaveURL(/\/playground\/local-/);
  await expect(page.getByRole("status").filter({ hasText: "Saved in this browser" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("connects a component to one placed under it, from bottom to top, and keeps the sides", async ({
  page,
}) => {
  await dragOntoCanvas(page, "API server", { x: 400, y: 150 });
  // The view re-centres on the first component, so place the database relative to where the server landed.
  const pane = (await canvas(page).boundingBox())!;
  const placed = (await node(page, "API server").boundingBox())!;
  await dragOntoCanvas(page, "SQL database", {
    x: placed.x - pane.x + placed.width / 2,
    y: placed.y - pane.y + 250,
  });
  await connect(page, node(page, "API server"), node(page, "SQL database"), ["bottom", "top"]);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const assertVertical = async () => {
    const server = (await node(page, "API server").boundingBox())!;
    const database = (await node(page, "SQL database").boundingBox())!;
    const line = (await page.locator(".react-flow__edge-path").first().boundingBox())!;
    // The line runs from the bottom edge of the server down to the top edge of the database.
    expect(Math.abs(line.y - (server.y + server.height))).toBeLessThan(8);
    expect(Math.abs(line.y + line.height - database.y)).toBeLessThan(8);
  };
  await assertVertical();

  await expect(page.getByRole("status").filter({ hasText: "Saved in this browser" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await assertVertical();
});

/** Places an API server with a SQL database under it and connects them right to left. */
async function stackedPair(page: Page) {
  await dragOntoCanvas(page, "API server", { x: 400, y: 150 });
  const pane = (await canvas(page).boundingBox())!;
  const placed = (await node(page, "API server").boundingBox())!;
  await dragOntoCanvas(page, "SQL database", {
    x: placed.x - pane.x + placed.width / 2,
    y: placed.y - pane.y + 250,
  });
  await connect(page, node(page, "API server"), node(page, "SQL database"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
}

/** Drags one end of the selected connection onto a side of a component. A new connection starts selected. */
async function dragEnd(page: Page, end: "source" | "target", to: Locator, side: Side) {
  const anchor = (await page.locator(`.react-flow__edgeupdater-${end}`).boundingBox())!;
  const target = (await to.locator(`.react-flow__handle-${side}`).boundingBox())!;
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

test("moves either end of a connection to another side by dragging it, never out of the left or into the right", async ({
  page,
}) => {
  await stackedPair(page);
  const server = node(page, "API server");
  const database = node(page, "SQL database");

  await dragEnd(page, "source", server, "bottom");
  await dragEnd(page, "target", database, "top");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  const line = (await page.locator(".react-flow__edge-path").first().boundingBox())!;
  const serverBox = (await server.boundingBox())!;
  const databaseBox = (await database.boundingBox())!;
  expect(Math.abs(line.y - (serverBox.y + serverBox.height))).toBeLessThan(8);
  expect(Math.abs(line.y + line.height - databaseBox.y)).toBeLessThan(8);

  await dragEnd(page, "source", server, "left");
  await expect(page.getByText(/can't leave from the left side/)).toBeVisible();
  await dragEnd(page, "target", database, "right");
  await expect(page.getByText(/can't end on the right side/)).toBeVisible();

  await dragEnd(page, "target", page.locator(".react-flow__node").filter({ hasText: "API server" }), "top");
  await expect(page.getByText(/draw a new connection/)).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("moves the ends of a connection from the inspector", async ({ page }) => {
  await stackedPair(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByRole("combobox", { name: "Leaves from" })).toHaveText("Right");

  await inspector.getByRole("combobox", { name: "Leaves from" }).click();
  await expect(page.getByRole("option", { name: /Left/ })).toBeDisabled();
  await page.getByRole("option", { name: "Bottom" }).click();
  await inspector.getByRole("combobox", { name: "Enters at" }).click();
  await expect(page.getByRole("option", { name: /Right/ })).toBeDisabled();
  await page.getByRole("option", { name: "Top" }).click();

  const line = (await page.locator(".react-flow__edge-path").first().boundingBox())!;
  const serverBox = (await node(page, "API server").boundingBox())!;
  expect(Math.abs(line.y - (serverBox.y + serverBox.height))).toBeLessThan(8);
});

test("refuses an invalid connection and explains why", async ({ page }) => {
  await dragOntoCanvas(page, "Web client", { x: 300, y: 250 });
  await dragOntoCanvas(page, "SQL database", { x: 800, y: 250 });
  await connect(page, node(page, "Web client"), node(page, "SQL database"));
  await expect(page.getByText("Route through an API server")).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});

test("one drag is one undo step", async ({ page }) => {
  await dragOntoCanvas(page, "API server", { x: 500, y: 300 });
  const server = node(page, "API server");
  const start = await position(server);

  const box = (await server.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 60 + i * 20, box.y + box.height / 2 + i * 10);
  await page.mouse.up();
  const moved = await position(server);
  expect(moved.x).toBeGreaterThan(start.x + 100);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => position(server)).toEqual(start);
  // A second undo removes the component itself: the drag didn't leave extra history entries.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
});

test("configures, duplicates and deletes with the keyboard", async ({ page }) => {
  await addByKeyboard(page, "API server");
  const instances = page.getByLabel("Instances", { exact: true });
  await instances.fill("5");
  await expect(node(page, "API server")).toContainText("5 ×");

  await canvas(page).click({ position: { x: 20, y: 20 } });
  await node(page, "API server").click();
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(node(page, "API server 2")).toContainText("5 ×");

  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("outline view describes the design as text", async ({ page }) => {
  await addByKeyboard(page, "Web client");
  await page.getByRole("button", { name: "Outline view (text)" }).click();
  const outline = page.getByRole("article", { name: "Architecture outline" });
  await expect(outline.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(outline).toContainText("Connects to nothing.");
});
