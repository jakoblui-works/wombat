// Spawned by main.test.ts: the real service (`main()`) with the fake agent harness (`fake-reply`, recording pids
// in $FAKE_AGENT_PID_DIR) and the test's own slice ($WOMBAT_TEST_SLICE) instead of the real ones.
import { main } from "../src/main.ts";
import { trackedHarness } from "./manager-fixtures.ts";

const { FAKE_AGENT_PID_DIR: pidDir, WOMBAT_TEST_SLICE: slice } = process.env;
if (!pidDir || !slice) throw new Error("service-entry needs FAKE_AGENT_PID_DIR and WOMBAT_TEST_SLICE");

await main({ harnesses: [trackedHarness("reply", pidDir)], slice });
