// S7 T15 (s7-24): a waiting agent without an open request asks "Waiting for you"; one with a request shows its title and kind.
import { expect, test } from "vitest";

import { atFor, summary } from "../../../../../../test/log-entries.ts";
import { needsMeRows } from "./needs-me-rows.ts";

const NOW = Date.parse(atFor(60));

test("a waiting agent without a request shows \"Waiting for you\", with no kind and no request to open", () => {
  const [row, ...others] = needsMeRows([summary("agent-a", { state: "waiting", title: "Fix the build" })], NOW);
  expect(others).toEqual([]);
  expect(row).toMatchObject({ agentId: "agent-a", requestId: undefined, title: "Fix the build", ask: "Waiting for you", kind: undefined });
});

test("a request row names what it asks and carries its kind and id", () => {
  const pending = { requestId: "req-1", at: atFor(30), title: "Run tests", kind: "execute" as const };
  const [row] = needsMeRows([summary("agent-b", { state: "waiting", pendingPermissions: [pending] })], NOW);
  expect(row).toMatchObject({ requestId: "req-1", ask: "Run tests", kind: "execute" });
});
