// A second checkout of the app inside an e2e sandbox, so a check can run a service from code that differs from what
// is on disk without touching the real checkout: service/ and shared/ copied (sources, test entries, package.json),
// their node_modules and the workspace's linked to the real ones. A service started from it (Sandbox.startService
// with `entry`, or an app launched with SWITCH.serviceEntry set to `entry`) hashes this copy's source, as the app does
// when its service entry lies in it. Removed with the sandbox.
import { appendFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { test, type Sandbox } from "./app-fixtures.ts";

export type AppCopy = {
  /** The copy's `app/` folder. */
  root: string;
  /** The copy's service entry for the e2e checks (service/test/app-e2e-entry.ts). */
  entry: string;
  /** Changes one of the service's source files in the copy (a comment appended), as an edit or a pull would. */
  changeServiceCode: () => void;
};

const realAppRoot = (): string => {
  const configFile = test.info().config.configFile;
  if (!configFile) throw new Error("Run these checks through `playwright test` with app/desktop/playwright.config.ts.");
  return path.resolve(path.dirname(configFile), "..");
};

export const appCopy = (sandbox: Sandbox, name = "app-copy"): AppCopy => {
  const real = realAppRoot();
  const root = path.join(sandbox.base, name, "app");
  mkdirSync(root, { recursive: true });
  cpSync(path.join(real, "package.json"), path.join(root, "package.json"));
  symlinkSync(path.join(real, "node_modules"), path.join(root, "node_modules"));
  for (const pkg of ["service", "shared"]) {
    for (const part of ["src", "test", "package.json"]) cpSync(path.join(real, pkg, part), path.join(root, pkg, part), { recursive: true });
    symlinkSync(path.join(real, pkg, "node_modules"), path.join(root, pkg, "node_modules"));
  }
  return {
    root,
    entry: path.join(root, "service", "test", "app-e2e-entry.ts"),
    changeServiceCode: () => appendFileSync(path.join(root, "service", "src", "main.ts"), "\n// Changed after this service started (e2e).\n"),
  };
};
