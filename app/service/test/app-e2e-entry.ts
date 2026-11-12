// The service as the desktop app's e2e checks run it (WOMBAT_E2E_SERVICE_ENTRY, and the fixture's own starts in
// desktop/e2e/app-fixtures.ts): the real `main()` with fake agents instead of the registered harnesses, the test's own
// systemd slice instead of the real one, and the pid of every start recorded, so a check can count how many services
// were started and which are still alive. A start that finds another service running exits 0, as the real one does.
//
//   FAKE_AGENT_PID_DIR          where the fake agents record their pids
//   WOMBAT_TEST_SLICE           the test's slice (never wombat-agents.slice)
//   WOMBAT_E2E_SERVICE_PID_DIR  where this entry records its own pid
//   WOMBAT_E2E_SANDBOX_ROOT     the test's sandbox: HOME, XDG_RUNTIME_DIR, XDG_STATE_HOME and the dirs above must lie
//                               under it, or the entry refuses to start (a launcher that rebuilt the env, or resolved
//                               /run/user/<uid> itself, must not reach the real discovery file, lock or store)
//
// Harnesses, in this order (the New agent dialog starts the first): `fake-reply` (answers and ends its turn),
// `fake-permission` (asks for a permission and waits), `fake-hang` (stays working until cancelled) and `fake-hostile`
// (hostile content everywhere agent content shows, then a permission request; see HOSTILE in fake-agent.ts).
import { writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import { main } from "../src/main.ts";
import { trackedHarness } from "./manager-fixtures.ts";

const { FAKE_AGENT_PID_DIR: pidDir, WOMBAT_TEST_SLICE: slice, WOMBAT_E2E_SERVICE_PID_DIR: servicePidDir, WOMBAT_E2E_SANDBOX_ROOT: root } =
  process.env;
if (!pidDir || !slice || !servicePidDir) {
  throw new Error("app-e2e-entry needs FAKE_AGENT_PID_DIR, WOMBAT_TEST_SLICE and WOMBAT_E2E_SERVICE_PID_DIR");
}
if (slice === "wombat-agents.slice") throw new Error("app-e2e-entry refuses the real slice; give the test its own");
if (!root || !isAbsolute(root)) throw new Error("app-e2e-entry needs WOMBAT_E2E_SANDBOX_ROOT, the test sandbox's absolute path");
const inside = (path: string | undefined) => {
  if (!path || !isAbsolute(path)) return false;
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
const places = {
  HOME: process.env.HOME,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  FAKE_AGENT_PID_DIR: pidDir,
  WOMBAT_E2E_SERVICE_PID_DIR: servicePidDir,
  ...(process.env.WOMBAT_STORE === undefined ? {} : { WOMBAT_STORE: process.env.WOMBAT_STORE }),
};
const outside = Object.entries(places).filter(([, path]) => !inside(path));
if (outside.length > 0) {
  process.stderr.write(
    `app-e2e-entry refuses to start: ${outside.map(([name, path]) => `${name}=${String(path)}`).join(", ")} isn't under the sandbox ${root}. ` +
      "Pass the test's env through to the service unchanged.\n",
  );
  process.exit(1);
}

writeFileSync(join(servicePidDir, String(process.pid)), "");

await main({
  harnesses: [
    trackedHarness("reply", pidDir),
    trackedHarness("permission", pidDir),
    trackedHarness("hang", pidDir),
    trackedHarness("hostile", pidDir),
  ],
  slice,
});
