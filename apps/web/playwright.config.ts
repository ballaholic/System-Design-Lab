import { defineConfig, devices } from "@playwright/test";

// End-to-end checks of what jsdom can't cover: dragging, connecting and reloading the real canvas.
// They run in guest mode, so no API or Supabase project is needed. Locally, set PW_CHANNEL=msedge (or chrome)
// to use an installed browser instead of downloading one.
const port = 5179;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: "https://e2e-placeholder.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_placeholder",
      VITE_API_BASE_URL: "",
    },
  },
});
