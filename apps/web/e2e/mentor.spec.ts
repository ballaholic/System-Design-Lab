import { expect, test } from "@playwright/test";

// Phase 5 in guest mode: the AI mentor and Interview mode explain that they need a verified account.

test("guests see the Mentor tab ask them to sign in, and come back to the same page", async ({ page }) => {
  await page.goto("/playground");
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector.getByRole("tab", { name: "Mentor" }).click();

  await expect(inspector.getByText("The AI mentor needs an account")).toBeVisible();
  await expect(inspector.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    /\/login\?next=%2Fplayground/,
  );
});

test("Interview mode is locked for guests, with the reason next to it", async ({ page }) => {
  await page.goto("/challenges/url-shortener");

  await expect(page.getByRole("button", { name: "Interview mode" })).toBeDisabled();
  await expect(page.getByText("Interview mode needs an account with a verified email.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Start in Guided mode/ })).toBeEnabled();
});
