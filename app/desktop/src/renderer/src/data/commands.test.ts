// A send's commandId comes from its variables, so a retry with the same variables is the same command.
import { MutationObserver } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";

import { fakeService } from "../../../../test/fake-bridge.ts";
import { user } from "../../../../../shared/test/log-entries.ts";
import { deleteAgentMutation, sendMessageFn, sendMessageVars } from "./commands.ts";
import { keys } from "./keys.ts";
import { type AgentLog, createQueryClient } from "./query-client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("sendMessageFn sends the commandId of its variables; a retry with them sends the same one, a new send another", async () => {
  const bodies: unknown[] = [];
  let status = 500;
  vi.stubGlobal("window", {
    wombat: {
      service: {
        request: (_method: string, _path: string, body: unknown) => {
          bodies.push(body);
          return Promise.resolve({ status, body: status === 202 ? { seq: 1 } : { error: { code: "internal_error", message: "Lost." } } });
        },
      },
    },
  });

  const vars = sendMessageVars("agent-bakery-1", "Fix the hours");
  await expect(sendMessageFn(vars)).rejects.toThrow("Lost.");
  status = 202;
  await sendMessageFn(vars);
  await sendMessageFn(sendMessageVars("agent-bakery-1", "Fix the hours"));

  const ids = bodies.map((body) => (body as { commandId: string }).commandId);
  expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[0]);
  expect(bodies[0]).toEqual({ text: "Fix the hours", commandId: ids[0] });
});

test("deleting an agent drops its cached log and reads the agents again", async () => {
  const service = fakeService();
  service.append("agent-bakery-1", user("Fix the hours"));
  service.append("agent-bakery-2", user("Check the menu"));
  // The fake has no DELETE route: this one deletes as the service would.
  const request = service.bridge.service.request;
  vi.stubGlobal("window", {
    wombat: {
      ...service.bridge,
      service: {
        ...service.bridge.service,
        request: (method: string, path: string, body?: unknown) => {
          if (method !== "DELETE") return request(method, path, body);
          service.removeAgent(decodeURIComponent(path.split("/").at(-1) ?? ""));
          return Promise.resolve({ status: 204, body: null });
        },
      },
    },
  });
  const client = createQueryClient();
  for (const agentId of ["agent-bakery-1", "agent-bakery-2"]) {
    client.setQueryData<AgentLog>(keys.log(agentId), { dbId: service.dbId(), entries: service.log(agentId), truncated: false });
  }
  client.setQueryData(keys.agents, { dbId: service.dbId(), seq: 2, agents: [] });

  await new MutationObserver(client, deleteAgentMutation(client)).mutate("agent-bakery-1");

  expect(client.getQueryData(keys.log("agent-bakery-1"))).toBeUndefined();
  expect(client.getQueryData(keys.log("agent-bakery-2"))).toBeDefined();
  expect(client.getQueryData<{ agents: { id: string }[] }>(keys.agents)?.agents.map(({ id }) => id)).toEqual(["agent-bakery-2"]);
});
