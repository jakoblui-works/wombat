import { execFileSync } from "node:child_process";
import path from "node:path";
import type { FullConfig } from "@playwright/test";

// Build the app before the checks run, so they never pass against a stale `out/`.
const globalSetup = (config: FullConfig): void => {
  if (!config.configFile) throw new Error("Run these checks through `playwright test` with app/desktop/playwright.config.ts.");
  const desktopDir = path.dirname(config.configFile);
  try {
    execFileSync("pnpm", ["exec", "electron-vite", "build"], { cwd: desktopDir, stdio: "inherit" });
  } catch (error) {
    throw new Error(
      `Building the app for the e2e checks failed (\`pnpm exec electron-vite build\` in ${desktopDir}); fix the build output above, then rerun.`,
      { cause: error },
    );
  }
};

export default globalSetup;
