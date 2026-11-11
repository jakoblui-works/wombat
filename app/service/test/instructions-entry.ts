// Spawned by the instructions tests (service-fixtures.ts): the real service (`main()`) with two fake agent
// harnesses on the mcp-config scenario, which records the raw session/new params it got. `fake-prompted` asks for
// the instructions exactly as the Claude Code harness does (its `sessionParams` hook); `fake-plain` asks for nothing.
import { claudeCode } from "../src/harness/claude-code.ts";
import { main } from "../src/main.ts";
import { trackedHarness } from "./manager-fixtures.ts";

const { FAKE_AGENT_PID_DIR: pidDir, WOMBAT_TEST_SLICE: slice } = process.env;
if (!pidDir || !slice) throw new Error("instructions-entry needs FAKE_AGENT_PID_DIR and WOMBAT_TEST_SLICE");

const recorder = trackedHarness("mcp-config", pidDir);
const { sessionParams } = claudeCode;

await main({
  harnesses: [
    { ...recorder, id: "fake-prompted", ...(sessionParams === undefined ? {} : { sessionParams }) },
    { ...recorder, id: "fake-plain" },
  ],
  slice,
});
