// The discovery file names the service's process by its pid and its start time, so the app never takes a pid reused
// by another process after a crash for the service. The real `main()` in a process of its own.
import { startTimeOf } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { TEST_TIMEOUT_MS } from "./manager-fixtures.ts";
import { startService } from "./service-fixtures.ts";

test(
  "the discovery file records the service process's start time",
  async () => {
    const service = await startService();
    expect(service.file.processStart, "no processStart in the discovery file").toBeDefined();
    expect(service.file.processStart).toBe(startTimeOf(service.file.pid));
  },
  TEST_TIMEOUT_MS,
);
