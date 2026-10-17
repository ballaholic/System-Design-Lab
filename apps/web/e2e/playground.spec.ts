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

async function connect(page: Page, from: Locator, to: Locator) {
  const source = await from.locator(".react-flow__handle-right").boundingBox();
  const target = await to.locator(".react-flow__handle-left").boundingBox();
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
  const instances = page.getByLabel("Instances");
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
