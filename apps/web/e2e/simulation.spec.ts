import { expect, type Locator, type Page, test } from "@playwright/test";
import { notifications, seedGuestDesign, urlShortener } from "./fixtures.ts";

// Phase 3 acceptance checks in a real browser, in guest mode (no API, no account).

const node = (page: Page, label: string) => page.locator(".react-flow__node").filter({ hasText: label });
const panel = (page: Page) => page.getByRole("region", { name: "Simulation" });

async function open(page: Page, title: string, doc: Record<string, unknown>) {
  await page.goto(await seedGuestDesign(page, title, doc));
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("button", { name: "Simulate" }).click();
  await expect(panel(page)).toBeVisible();
  // The panel takes space from the canvas; bring every component back into view.
  await page.getByRole("button", { name: "Fit to screen" }).click();
}

async function setTraffic(page: Page, rps: number) {
  await panel(page).getByLabel("Total traffic (requests/s)").fill(String(rps));
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

const operationRow = (page: Page, name: string) =>
  panel(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

test("raising traffic saturates the database, and a cache at 80% hits fixes it", async ({ page }) => {
  await open(page, "URL shortener", urlShortener());
  await expect(node(page, "PostgreSQL")).toContainText("OK");
  await expect(panel(page)).toContainText("100%");

  await setTraffic(page, 11_000);
  const db = node(page, "PostgreSQL");
  await expect(db).toContainText("Saturated");
  await expect(db).toContainText("200%");
  // First in the bottleneck list, and redirects now fail half the time.
  const bottlenecks = panel(page).getByRole("region", { name: "Bottlenecks" }).getByRole("listitem");
  await expect(bottlenecks.first()).toContainText("PostgreSQL reads");
  await expect(operationRow(page, "Follow short link")).toContainText("50%");

  // Add a cache, connect it and accept the suggested cache-aside step.
  await page
    .getByRole("complementary", { name: "Components" })
    .getByRole("button", { name: "Cache", exact: true })
    .dragTo(page.locator(".react-flow__pane"), { targetPosition: { x: 700, y: 60 } });
  await connect(page, node(page, "API server"), node(page, "Cache"));
  const suggestion = page.getByRole("listitem").filter({ hasText: "Follow short link:" });
  await suggestion.getByRole("button", { name: "Add" }).click();

  await expect(db).toContainText("OK");
  await expect(operationRow(page, "Follow short link")).toContainText("100%");
  // Only misses reach the database: reads drop from 200% to 40% (the badge shows writes, now the busier side).
  await panel(page).getByRole("tab", { name: "Components" }).click();
  const dbRow = panel(page).getByRole("row").filter({ hasText: "PostgreSQL" });
  await expect(dbRow).toContainText("reads 40%");
});

test("primary database down with a cache: reads succeed at the hit rate, writes fail, failover is not modeled", async ({
  page,
}) => {
  await open(page, "URL shortener", urlShortener({ cache: true, replica: true }));
  await setTraffic(page, 11_000);

  await node(page, "PostgreSQL").click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Primary down" }).click();

  await expect(node(page, "PostgreSQL")).toContainText("Down");
  await expect(panel(page).getByRole("list", { name: "Injected failures" })).toContainText(
    '"PostgreSQL" is down',
  );
  await expect(operationRow(page, "Follow short link")).toContainText("80%");
  await expect(operationRow(page, "Create short link")).toContainText("0%");

  await panel(page)
    .getByRole("tab", { name: /Events/ })
    .click();
  await expect(panel(page)).toContainText("replication and failover aren't modeled");
});

test("worker down: the backlog grows while publishing still succeeds", async ({ page }) => {
  await open(page, "Notifications", notifications());

  await page.getByRole("button", { name: "Inject failures" }).click();
  await page.getByRole("switch", { name: "Notifier: Worker down" }).click();
  await page.keyboard.press("Escape");

  await expect(node(page, "Notifier")).toContainText("Down");
  await expect(operationRow(page, "Create link")).toContainText("100%");
  await expect(panel(page)).toContainText("+1,000");
  await panel(page)
    .getByRole("tab", { name: /Events/ })
    .click();
  await expect(panel(page)).toContainText('"Notifications" backlog grows by 1,000 messages/s.');
});

test("simulates without any network calls, shows the engine version and links to the assumptions", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.goto(await seedGuestDesign(page, "URL shortener", urlShortener({ cache: true })));
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  page.on("request", (r) => {
    const url = new URL(r.url());
    // Vite serves modules lazily from the same origin; anything else would be a network call.
    if (url.origin !== new URL(page.url()).origin || url.pathname.startsWith("/api/")) requests.push(r.url());
  });

  await page.getByRole("button", { name: "Simulate" }).click();
  await setTraffic(page, 20_000);
  await panel(page).getByRole("tab", { name: "Sweep" }).click();
  await expect(panel(page).getByRole("img", { name: "Success rate by total traffic" })).toBeVisible();
  await panel(page).getByRole("tab", { name: "Components" }).click();
  await expect(panel(page).getByRole("table")).toContainText("Redis");
  expect(requests).toEqual([]);

  await expect(panel(page)).toContainText(/Engine v\d+\.\d+\.\d+/);
  const docsLink = panel(page).getByRole("link", { name: /How the simulator works/ });
  await expect(docsLink).toHaveAttribute("href", "/docs/simulator");
  await page.goto("/docs/simulator");
  await expect(page.getByRole("heading", { name: "Assumptions" })).toBeVisible();
  await expect(page.getByText("A-OVERLOAD-SHED")).toBeVisible();
});
