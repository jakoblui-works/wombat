import { defineConfig } from "@playwright/test";

// End-to-end checks against the built app (`out/main/index.js`); `global-setup.ts` builds it first.
// Each test launches its own app, hidden (`WOMBAT_E2E=1`), so they run one at a time.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env["CI"],
  reporter: "list",
  outputDir: "test-results",
});
