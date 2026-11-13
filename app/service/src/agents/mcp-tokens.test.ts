// A process gets a live /mcp token only while it runs: none once it is ending, for any reason, or closed.
import { describe, expect, test } from "vitest";

import { createMcpTokens, type McpTokens } from "./mcp-tokens.ts";
import { type AgentPhase, next, type PhaseEvent, STARTING } from "./phase.ts";
import type { Proc } from "./proc.ts";

const run = (...events: PhaseEvent[]) => events.reduce(next, STARTING);
const recorded: PhaseEvent = { type: "recorded" };

const procIn = (phase: AgentPhase) => ({ agentId: "agent-a", phase }) as Proc;

const bearerTokens = (servers: ReturnType<McpTokens["mcpServersFor"]>) =>
  servers.flatMap((server) =>
    "headers" in server ? server.headers.filter((h) => h.name === "Authorization").map((h) => h.value.replace(/^Bearer /, "")) : [],
  );

describe("mcpServersFor", () => {
  test.each<[string, boolean, AgentPhase]>([
    ["starting", true, run()],
    ["idle", true, run(recorded)],
    ["stopping before it was recorded", false, run({ type: "endRequested", why: "stop" })],
    ["removed before it was recorded", false, run({ type: "endRequested", why: "remove" })],
    ["exited before it was recorded", false, run({ type: "exited" })],
    ["stopping", false, run(recorded, { type: "endRequested", why: "stop" })],
    ["being removed", false, run(recorded, { type: "endRequested", why: "remove" })],
    ["exited", false, run(recorded, { type: "exited" })],
    ["closed", false, run(recorded, { type: "closed" })],
  ])("a process %s gets a token for its agent: %s", (_, mints, phase) => {
    const tokens = createMcpTokens({ isCurrent: () => true, shuttingDown: () => false });
    tokens.setMcpUrl("http://127.0.0.1:4100/mcp");

    const minted = bearerTokens(tokens.mcpServersFor(procIn(phase)));

    expect(minted.map(tokens.agentForToken)).toEqual(mints ? ["agent-a"] : []);
  });
});
