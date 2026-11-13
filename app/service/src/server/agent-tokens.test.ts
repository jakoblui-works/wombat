// Agent and app tokens apart. An agent's token opens /mcp only, and acts as that
// agent; the app's token never opens /mcp; on /mcp a request without the agent token, with an Origin, or with a
// foreign Host is refused; a token stops working when its agent is stopped, deleted, crashes, is killed, or the
// service shuts down; a resumed agent gets a new one. Otherwise an agent could drive other agents or approve
// its own proposals.
import { describe, expect, test } from "vitest";

import { APP_ORIGIN, appRoutes, expectError } from "../../test/server-fixtures.ts";
import { TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { agentConfig, callTool, isRefused, mcpRequest, serveItems } from "../../test/mcp-fixtures.ts";

const toolsListed = async (...args: Parameters<typeof mcpRequest>) => {
  const response = await mcpRequest(...args);
  return response.status === 200 && JSON.stringify(response.json).includes("list_items");
};

describe("agent and app tokens apart", () => {
  test(
    "the agent gets a wombat entry for this server's /mcp with a token of its own, and the token opens /mcp",
    async () => {
      const { s } = await serveItems();

      const a = await agentConfig(s);
      const b = await agentConfig(s);

      const entry = a.mcpServers.find((candidate) => candidate.name === "wombat");
      expect(entry?.type).toBe("http");
      expect(entry?.url).toBe(`http://127.0.0.1:${s.port}/mcp`);
      expect(a.token.length).toBeGreaterThan(0);
      expect(a.token).not.toBe(b.token);
      expect(a.token).not.toBe(s.token);
      expect(await toolsListed(s, a.token, "tools/list")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an agent token opens no app route, and the app token doesn't open /mcp",
    async () => {
      const { s } = await serveItems();
      const a = await agentConfig(s);

      for (const route of appRoutes(a.agentId)) {
        const response = await s.request({ ...route, headers: { authorization: `Bearer ${a.token}` } });
        expectError(response, 401, "unauthorized", `${route.method} ${route.path} with an agent token`);
      }
      for (const headers of [{}, { origin: APP_ORIGIN }]) {
        expect(isRefused(await mcpRequest(s, s.token, "tools/list", {}, { headers })), "the app token on /mcp").toBe(true);
      }
      // The agent is untouched by the refused calls above.
      expect(s.agent(a.agentId)?.state).not.toBe("stopped");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "on /mcp, no token, a wrong token, any Origin or a foreign Host is refused",
    async () => {
      const { s } = await serveItems();
      const a = await agentConfig(s);
      const otherPort = s.port === 65535 ? s.port - 1 : s.port + 1;

      const cases = [
        { what: "no token", token: undefined, options: {} },
        { what: "a wrong token", token: `${a.token}x`, options: {} },
        { what: "a prefix of the token", token: a.token.slice(0, -1), options: {} },
        { what: "the app's Origin", token: a.token, options: { headers: { origin: APP_ORIGIN } } },
        { what: "a foreign Host", token: a.token, options: { host: `evil.example:${s.port}` } },
        { what: "another port in Host", token: a.token, options: { host: `127.0.0.1:${otherPort}` } },
      ];
      for (const { what, token, options } of cases) {
        expect(isRefused(await mcpRequest(s, token, "tools/list", {}, options)), what).toBe(true);
      }
      // Control: the same token, without an Origin and with the right Host, works.
      expect(await toolsListed(s, a.token, "tools/list")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a call with an agent's token acts as that agent",
    async () => {
      const { s } = await serveItems();
      const a = await agentConfig(s);
      const b = await agentConfig(s);

      const fromA = await callTool(s, a.token, "propose_create", { structure: "bugs", title: "Proposed by A", reason: "Seen by A" });
      const fromB = await callTool(s, b.token, "propose_create", { structure: "bugs", title: "Proposed by B", reason: "Seen by B" });

      const listed = await s.api("GET", "/proposals");
      const proposals = (listed.json as { proposals: { id: string; agentId: string }[] }).proposals;
      const byId = new Map(proposals.map((proposal) => [proposal.id, proposal.agentId]));
      expect(byId.get((fromA.json as { proposed: string }).proposed)).toBe(a.agentId);
      expect(byId.get((fromB.json as { proposed: string }).proposed)).toBe(b.agentId);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a token stops working when its agent is stopped or killed, and at shutdown",
    async () => {
      const { s } = await serveItems();
      const tokens: { what: string; token: string }[] = [];

      const stopped = await agentConfig(s);
      await s.manager.stop(stopped.agentId);
      tokens.push({ what: "stopped", token: stopped.token });

      const before = new Set(s.pids());
      const killed = await agentConfig(s);
      const pid = s.pids().find((candidate) => !before.has(candidate));
      expect(pid, "the killed agent's pid").toBeDefined();
      if (pid !== undefined) process.kill(pid, "SIGKILL");
      await waitFor("the kill recorded", () => ["error", "stopped"].includes(s.agent(killed.agentId)?.state ?? ""));
      tokens.push({ what: "killed", token: killed.token });

      const running = await agentConfig(s);
      expect(await toolsListed(s, running.token, "tools/list"), "a running agent's token, as a control").toBe(true);
      for (const { what, token } of tokens) {
        expect(isRefused(await mcpRequest(s, token, "tools/list")), `the token of an agent ${what}`).toBe(true);
      }

      await s.manager.shutdown();
      expect(isRefused(await mcpRequest(s, running.token, "tools/list")), "a token after shutdown").toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  // A token never outlives its process, so a resumed agent gets a new one; with the old one its
  // Wombat tools would fail, and reviving the old one would let a dead process's token back in.
  test(
    "a resumed agent gets a new token that acts as the same agent; the stopped process's token stays refused, and the new one ends with its process",
    async () => {
      const { s } = await serveItems();
      const first = await agentConfig(s);
      await s.manager.stop(first.agentId);

      const resumed = await agentConfig(s, first.agentId);

      expect(resumed.token, "a new token").not.toBe(first.token);
      expect(isRefused(await mcpRequest(s, first.token, "tools/list")), "the stopped process's token").toBe(true);
      expect(await toolsListed(s, resumed.token, "tools/list"), "the resumed process's token opens /mcp").toBe(true);
      const proposed = await callTool(s, resumed.token, "propose_create", { structure: "bugs", title: "Proposed after the resume", reason: "Seen again" });
      const listed = await s.api("GET", "/proposals");
      const proposals = (listed.json as { proposals: { id: string; agentId: string }[] }).proposals;
      expect(proposals.find((proposal) => proposal.id === (proposed.json as { proposed: string }).proposed)?.agentId, "acts as the same agent").toBe(first.agentId);

      await s.manager.stop(first.agentId);
      expect(isRefused(await mcpRequest(s, resumed.token, "tools/list")), "the resumed process's token once it is stopped").toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
