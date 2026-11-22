// The items alert through the service as a process (its real start-up wiring): a hand edit of an item file and an
// agent's write each reach GET /events as an alert that carries exactly seq, dbId and type "items", nothing of the
// item.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ACCESS_FILES } from "./access-fixtures.ts";
import { TEST_TIMEOUT_MS } from "./manager-fixtures.ts";
import { APP_ORIGIN, openStream, type Stream } from "./server-fixtures.ts";
import { agentTool, PLAIN, startRecorded, startService, type RunningService } from "./service-fixtures.ts";

/** Written by each change; never on the alert stream. */
const MARKER = "Pinned to the quokka fixture";

const itemsAlerts = (stream: Stream) =>
  stream
    .events()
    .filter((event) => event.data !== "")
    .map((event) => JSON.parse(event.data) as Record<string, unknown>)
    .filter((alert) => alert.type === "items");

const CHANGES = [
  {
    what: "a hand edit of an item file",
    change: (service: RunningService) => {
      const path = join(service.itemsRoot ?? "", "backlog/BL-1-items.md");
      writeFileSync(path, readFileSync(path, "utf8").replace("owner: Sam", `owner: ${MARKER}`));
      return Promise.resolve();
    },
  },
  {
    what: "an agent's update_item",
    change: async (service: RunningService) => {
      const { token } = await startRecorded(service, PLAIN);
      const { version } = (await agentTool(service, token, "get_item", { handle: "BL-1" })) as { version: string };
      await agentTool(service, token, "update_item", { handle: "BL-1", fields: { owner: MARKER }, version });
    },
  },
];

describe("the items alert", () => {
  test.each(CHANGES)(
    "$what reaches GET /events as an items alert with exactly seq, dbId and type",
    async ({ change }) => {
      const service = await startService({ items: ACCESS_FILES });
      const stream = await openStream(service.file.port, { headers: { authorization: `Bearer ${service.file.token}`, origin: APP_ORIGIN } });
      expect(stream.status).toBe(200);
      const before = itemsAlerts(stream).length;

      await change(service);

      await stream.until("an items alert", (current) => itemsAlerts(current).length > before);
      expect(readFileSync(join(service.itemsRoot ?? "", "backlog/BL-1-items.md"), "utf8"), "the change was made").toContain(MARKER);
      for (const alert of itemsAlerts(stream)) expect(Object.keys(alert).sort()).toEqual(["dbId", "seq", "type"]);
      expect(stream.raw().includes(MARKER), "the written text on the alert stream").toBe(false);
    },
    TEST_TIMEOUT_MS * 2,
  );
});
