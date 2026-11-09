// Preloaded into fake agents by the manager tests (`node --import`): records the agent's pid as an empty
// file in $FAKE_AGENT_PID_DIR, so a test can check that every agent process it caused is gone.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FAKE_AGENT_PID_DIR;
if (dir) writeFileSync(join(dir, String(process.pid)), "");
