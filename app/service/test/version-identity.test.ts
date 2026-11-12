// Contract "Service identity", the service's side: GET /version says when this service started and which code it
// runs, as codeIdOf hashes the checkout the service was started from (the app hashes the code on disk with the same
// function and calls the service stale when the two differ). The real `main()` in a process of its own.
import { join } from "node:path";

import { codeIdOf } from "@wombat/shared/code-id";
import { expect, test } from "vitest";

import { TEST_TIMEOUT_MS, waitFor } from "./manager-fixtures.ts";
import { startService } from "./service-fixtures.ts";

/** The `app/` folder this service's code was loaded from. */
const APP_ROOT = join(import.meta.dirname, "..", "..");

type Version = { apiVersion?: unknown; startedAt?: unknown; codeId?: unknown };

test(
  "/version names the code the service was started from and a start time fixed at its start",
  async () => {
    const spawnedAt = Date.now();
    const service = await startService();
    const listeningAt = Date.now();

    const first = await service.api("GET", "/version");
    expect(first.status).toBe(200);
    const version = first.json as Version;
    expect(typeof version.codeId, "no codeId").toBe("string");
    expect(typeof version.startedAt, "no startedAt").toBe("string");
    expect(version.codeId, "codeId isn't codeIdOf the checkout the service runs from").toBe(codeIdOf(APP_ROOT));
    const startedAt = Date.parse(version.startedAt as string);
    expect(startedAt, "startedAt isn't a time").not.toBeNaN();
    expect(startedAt, "startedAt is before the process was spawned").toBeGreaterThanOrEqual(spawnedAt - 1);
    expect(startedAt, "startedAt is after the service was listening").toBeLessThanOrEqual(listeningAt);

    // Asked again once the clock has moved on: the same start, the same code.
    await waitFor("the clock to move on", () => Date.now() > listeningAt + 5);
    const second = (await service.api("GET", "/version")).json as Version;
    expect(second.startedAt, "startedAt moved: it's computed per request, not once at start").toBe(version.startedAt);
    expect(second.codeId).toBe(version.codeId);
  },
  TEST_TIMEOUT_MS,
);
