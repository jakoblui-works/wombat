// The alerts that read a list again or reset the cache (the log appends are in alerts.test.ts).
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";

import { FAKE_WORKSPACE, fakeService, type FakeService } from "../../../../test/fake-bridge.ts";
import { summary } from "../../../../test/summaries.ts";
import { connectAlerts } from "./alerts.ts";
import { keys } from "./keys.ts";
import { createQueryClient } from "./query-client.ts";

const A = "agent-bakery-1";

let disconnect: (() => void) | undefined;
afterEach(() => {
  disconnect?.();
  disconnect = undefined;
  vi.unstubAllGlobals();
});

const setup = (): { service: FakeService; client: QueryClient } => {
  const service = fakeService();
  vi.stubGlobal("window", { wombat: service.bridge });
  const client = createQueryClient();
  disconnect = connectAlerts(client, service.bridge);
  service.connection("connected");
  client.setQueryData(keys.agents, { dbId: service.dbId(), seq: 0, agents: [summary(A)] });
  client.setQueryData(keys.harnesses, [{ id: "fake-reply", name: "Fake reply" }]);
  client.setQueryData(keys.proposals, { proposals: [] });
  return { service, client };
};

const reads = async (service: FakeService): Promise<string[]> => {
  await vi.waitFor(() => expect(service.inFlight()).toBe(0));
  return service.requests().map(({ method, path }) => `${method} ${path}`);
};

test("a proposal alert reads the proposals again and nothing else", async () => {
  const { service } = setup();
  service.alert("agent_changed", A, { type: "proposal", proposalId: "proposal-1" });
  await vi.waitFor(() => expect(service.requests()).not.toEqual([]));
  expect(await reads(service)).toEqual(["GET /proposals"]);
});

test.each<[string, (service: FakeService) => void]>([
  [
    "a reconnect",
    (service) => {
      service.connection("reconnecting");
      service.connection("connected");
    },
  ],
  ["an items alert", (service) => service.alert("agent_changed", A, { type: "items", workspace: FAKE_WORKSPACE.id })],
  ["a workspaces alert", (service) => service.alert("agent_changed", A, { type: "workspaces" })],
])("%s reads the binders, every cached binder's items and every cached item again", async (_name, trigger) => {
  const { service, client } = setup();
  client.setQueryData(keys.binders(FAKE_WORKSPACE.id), { binders: [] });
  client.setQueryData(keys.binderItems(FAKE_WORKSPACE.id, "bugs"), { items: [] });
  client.setQueryData(keys.item(FAKE_WORKSPACE.id, "BUG-1"), { id: "bug-1" });
  trigger(service);
  await vi.waitFor(() => expect(service.requests()).not.toEqual([]));
  const ws = `/workspaces/${FAKE_WORKSPACE.id}`;
  expect(await reads(service)).toEqual(expect.arrayContaining([`GET ${ws}/binders`, `GET ${ws}/binders/bugs/items`, `GET ${ws}/items/BUG-1`]));
});

// Two workspaces can each have a binder `bugs` and an item `BUG-1`: one workspace's change must not show under the
// other's, nor read the other's again.
test("an items alert for one workspace reads only that workspace's binders and items again, leaving another workspace's cache as it was", async () => {
  const { service, client } = setup();
  const other = "ws-other00002";
  const cached = (ws: string) => {
    client.setQueryData(keys.binders(ws), { binders: [{ id: `bugs-of-${ws}` }] });
    client.setQueryData(keys.binderItems(ws, "bugs"), { items: [{ id: `item-of-${ws}` }] });
    client.setQueryData(keys.item(ws, "BUG-1"), { id: `bug-1-of-${ws}` });
  };
  cached(FAKE_WORKSPACE.id);
  cached(other);
  const otherCache = () => ({
    binders: client.getQueryData(keys.binders(other)),
    items: client.getQueryData(keys.binderItems(other, "bugs")),
    item: client.getQueryData(keys.item(other, "BUG-1")),
  });
  const before = otherCache();
  expect(before).toEqual({ binders: { binders: [{ id: `bugs-of-${other}` }] }, items: { items: [{ id: `item-of-${other}` }] }, item: { id: `bug-1-of-${other}` } });

  service.alert("agent_changed", A, { type: "items", workspace: FAKE_WORKSPACE.id });
  await vi.waitFor(() => expect(service.requests()).not.toEqual([]));

  const ws = `/workspaces/${FAKE_WORKSPACE.id}`;
  const read = await reads(service);
  expect(read).toEqual(expect.arrayContaining([`GET ${ws}/binders`, `GET ${ws}/binders/bugs/items`, `GET ${ws}/items/BUG-1`]));
  expect(read.filter((request) => request.includes(other)), "reads of the other workspace").toEqual([]);
  expect(otherCache()).toEqual(before);
});
