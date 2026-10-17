import { expect, type Locator, type Page, test } from "@playwright/test";

// Phase 4 acceptance: a guest completes the URL Shortener in Guided mode, and progress survives a reload.

const node = (page: Page, label: string) => page.locator(".react-flow__node").filter({ hasText: label });
const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const checklist = (page: Page) => inspector(page).getByRole("region", { name: "Checklist" });

async function drop(page: Page, name: string, at: { x: number; y: number }) {
  await page
    .getByRole("complementary", { name: "Components" })
    .getByRole("button", { name, exact: true })
    .dragTo(page.locator(".react-flow__pane"), { targetPosition: at });
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

/** Accepts every suggested step for the selected connection (they're in the Inspect tab). */
async function acceptSuggestions(page: Page, only?: string) {
  await inspector(page).getByRole("tab", { name: "Inspect" }).click();
  const suggestions = inspector(page).getByRole("region", { name: "Suggested steps" });
  const items = only
    ? suggestions.getByRole("listitem").filter({ hasText: only })
    : suggestions.getByRole("listitem");
  while ((await items.count()) > 0) await items.first().getByRole("button", { name: "Add" }).click();
  await inspector(page).getByRole("tab", { name: "Challenge" }).click();
}

async function answerDecision(page: Page, option: string | RegExp) {
  await inspector(page).getByLabel(option).check();
  await inspector(page).getByRole("button", { name: "Submit" }).click();
}

test("a guest completes all three stages in Guided mode and keeps the progress", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/challenges");
  await page.getByRole("link", { name: /URL Shortener/ }).click();
  await page.getByRole("button", { name: "Start in Guided mode" }).click();
  await expect(page).toHaveURL(/\/challenges\/url-shortener\/attempt\/local-attempt-/);
  await expect(node(page, "Users")).toBeVisible();

  // Stage 1: estimates (a wrong answer first), a decision, and the baseline design.
  const rate = inspector(page).getByLabel("Your estimate (redirects/s)");
  await rate.fill("1000");
  await inspector(page).getByRole("button", { name: "Check" }).first().click();
  await expect(inspector(page)).toContainText("Not quite (1 attempt)");
  await rate.fill("120");
  await inspector(page).getByRole("button", { name: "Check" }).first().click();
  await expect(inspector(page)).toContainText("Close enough");
  await inspector(page).getByLabel("Your estimate (GB)").fill("900");
  await inspector(page).getByRole("button", { name: "Check" }).click();
  await answerDecision(page, /^Give each link the next number/);

  // Hints reveal one at a time.
  await inspector(page).getByRole("button", { name: "Show hint 1 of 3" }).click();
  await expect(inspector(page).getByRole("button", { name: "Show hint 2 of 3" })).toBeVisible();

  await drop(page, "Load balancer", { x: 330, y: 120 });
  await drop(page, "API server", { x: 330, y: 300 });
  await drop(page, "SQL database", { x: 600, y: 300 });
  await connect(page, node(page, "Users"), node(page, "Load balancer"));
  await connect(page, node(page, "Load balancer"), node(page, "API server"));
  await connect(page, node(page, "API server"), node(page, "SQL database"));
  await acceptSuggestions(page);

  const passed = page.getByRole("dialog");
  await expect(passed).toContainText("Stage 1 passed");
  await expect(passed).toContainText("Sign in to keep a checkpoint");
  await passed.getByRole("button", { name: "Continue to stage 2" }).click();

  // Stage 2: 11,000 rps needs more API instances and a cache in front of the database.
  await expect(checklist(page)).toContainText("No component is saturated");
  await node(page, "API server").click();
  await inspector(page).getByRole("tab", { name: "Inspect" }).click();
  await inspector(page).getByLabel("Instances", { exact: true }).fill("16");
  await drop(page, "Cache", { x: 600, y: 80 });
  await connect(page, node(page, "API server"), node(page, "Cache"));
  await acceptSuggestions(page, "Follow short link");
  await answerDecision(page, /^302:/);
  await expect(passed).toContainText("Stage 2 passed");
  await passed.getByRole("button", { name: "Continue to stage 3" }).click();

  // Stage 3: the database goes down; cached redirects survive, and a decision completes it.
  await expect(node(page, "SQL database")).toContainText("Down");
  await answerDecision(page, /^Run a replica/);
  await expect(passed).toContainText("URL Shortener complete");
  await passed.getByRole("button", { name: "Keep exploring" }).click();

  // Progress is kept in this browser.
  await page.reload();
  await expect(inspector(page)).toContainText("Challenge complete");
  await expect(inspector(page).getByRole("list", { name: "Stages" })).toContainText("passed");
  await page.goto("/challenges");
  await expect(page.getByText("Completed")).toBeVisible();
});

test("starting over asks first, then abandons the attempt in progress", async ({ page }) => {
  await page.goto("/challenges/url-shortener");
  await page.getByRole("button", { name: "Start in Guided mode" }).click();
  await expect(page).toHaveURL(/attempt\/local-attempt-/);
  const first = page.url();

  await page.goto("/challenges/url-shortener");
  await expect(page.getByRole("link", { name: "Continue stage 1" })).toBeVisible();
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("abandons that attempt");
  await page.getByRole("button", { name: "Start over" }).last().click();
  await expect(page).toHaveURL(/attempt\/local-attempt-/);
  expect(page.url()).not.toBe(first);
});
