// The alerts that read a list again or reset the cache (the log appends are in alerts.test.ts).
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";

import { fakeService, type FakeService } from "../../../../test/fake-bridge.ts";
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

test.each(["agent_added", "agent_changed"] as const)("%s reads the agents again and nothing else", async (type) => {
  const { service } = setup();
  service.alert(type, A);
  await vi.waitFor(() => expect(service.requests()).not.toEqual([]));
  expect(await reads(service)).toEqual(["GET /agents"]);
});

test("a proposal alert reads the proposals again and nothing else", async () => {
  const { service } = setup();
  service.alert("agent_changed", A, { type: "proposal", proposalId: "proposal-1" });
  await vi.waitFor(() => expect(service.requests()).not.toEqual([]));
  expect(await reads(service)).toEqual(["GET /proposals"]);
});

test("an alert from another store than the cached agents' resets every query", () => {
  const { service, client } = setup();
  service.alert("agent_changed", A, { dbId: "db-2" });
  for (const key of [keys.agents, keys.harnesses, keys.proposals]) expect(client.getQueryData(key)).toBeUndefined();
});
