// For tests of an approve cut off by a service death: the real service, as service-entry.ts runs it, that kills its
// own process (SIGKILL, so nothing of the stop path runs) at the approve step $WOMBAT_TEST_STOP_AT names.
import { main } from "../src/main.ts";
import { APPROVE_STEPS } from "../src/proposals/apply.ts";
import { trackedHarness } from "./manager-fixtures.ts";

const { FAKE_AGENT_PID_DIR: pidDir, WOMBAT_TEST_SLICE: slice, WOMBAT_TEST_STOP_AT: stopAt } = process.env;
if (!pidDir || !slice) throw new Error("stop-at-entry needs FAKE_AGENT_PID_DIR and WOMBAT_TEST_SLICE");
const step = APPROVE_STEPS.find((candidate) => candidate === stopAt);
if (step === undefined) throw new Error(`stop-at-entry needs WOMBAT_TEST_STOP_AT set to one of ${APPROVE_STEPS.join(", ")}`);

await main({
  harnesses: [trackedHarness("reply", pidDir)],
  slice,
  onApproveStep: (reached) => {
    if (reached === step) process.kill(process.pid, "SIGKILL");
  },
});
