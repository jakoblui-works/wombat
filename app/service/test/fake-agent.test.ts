// End to end: the scripted fake ACP agent, spawned through the real spawn path and driven by a minimal ACP
// client. Every session update the client receives must parse with the shared `SessionUpdate` schema.
import { tmpdir } from "node:os";

import { describe, expect, onTestFinished, test } from "vitest";

import { ENV_ALLOWLIST } from "../src/harness/env.ts";
import { runAgent, updatesOf, type AgentUnderTest } from "./acp-client.ts";
import { type FakeScenario, HOSTILE } from "./fake-agent.ts";
import { fakeHarness } from "./fake-harness.ts";

/** Per-row timeout, in one place: each row is a process start plus a few messages. */
const ROW_TIMEOUT_MS = 10_000;

const cwd = tmpdir();

const start = (scenario: FakeScenario, source?: NodeJS.ProcessEnv, answer?: "allow_once" | "reject_once") => {
  const run = runAgent(fakeHarness(scenario).spawn(cwd, source), answer ? { answer } : {});
  onTestFinished(() => run.kill());
  return run;
};

const isSettled = async (promise: Promise<unknown>) => {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
};

type Row = { scenario: FakeScenario; answer?: "allow_once"; play: (run: AgentUnderTest) => Promise<void> };

const rows: Row[] = [
  {
    scenario: "reply",
    play: async (run) => {
      const response = await run.prompt(await run.newSession(cwd), "Hello");
      expect(response.stopReason).toBe("end_turn");
      const texts = updatesOf(run).flatMap((update) =>
        update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? [update.content.text] : [],
      );
      expect(texts.join("")).not.toBe("");
    },
  },
  {
    scenario: "permission",
    answer: "allow_once",
    play: async (run) => {
      const response = await run.prompt(await run.newSession(cwd), "Edit the file");
      expect(response.stopReason).toBe("end_turn");

      const toolCallAt = run.received.findIndex(
        (item) => item.type === "update" && item.update.sessionUpdate === "tool_call",
      );
      const toolCall = run.received[toolCallAt];
      if (toolCall?.type !== "update" || toolCall.update.sessionUpdate !== "tool_call") {
        throw new Error("no tool_call update received");
      }
      expect(toolCall.update.kind).toBe("edit");
      expect(toolCall.update.content).toContainEqual(
        expect.objectContaining({
          type: "diff",
          path: expect.any(String) as unknown,
          oldText: expect.any(String) as unknown,
          newText: expect.any(String) as unknown,
        }),
      );

      const permissionAt = run.received.findIndex((item) => item.type === "permission");
      const permission = run.received[permissionAt];
      if (permission?.type !== "permission") throw new Error("no permission request received");
      expect(permissionAt).toBeGreaterThan(toolCallAt);
      expect(permission.request.toolCall.toolCallId).toBe(toolCall.update.toolCallId);
      expect(permission.request.options.map((option) => option.kind)).toEqual(
        expect.arrayContaining(["allow_once", "reject_once"]),
      );

      const afterAnswer = run.received.slice(permissionAt + 1).flatMap((item) => (item.type === "update" ? [item.update] : []));
      expect(afterAnswer).toContainEqual(
        expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.update.toolCallId,
          status: "completed",
        }),
      );
    },
  },
  {
    scenario: "image",
    play: async (run) => {
      const response = await run.prompt(await run.newSession(cwd), "Show me");
      expect(response.stopReason).toBe("end_turn");
      // The shared schema turns an image with invalid or empty base64 into a placeholder, so this checks the data too.
      expect(updatesOf(run)).toContainEqual(
        expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: expect.objectContaining({ type: "image", mimeType: "image/png" }) as unknown,
        }),
      );
    },
  },
  {
    scenario: "auth",
    play: async (run) => {
      await expect(run.newSession(cwd)).rejects.toMatchObject({ code: -32000 });
    },
  },
  {
    scenario: "crash",
    play: async (run) => {
      const prompt = run.prompt(await run.newSession(cwd), "Go");
      const outcome = await Promise.race([
        prompt.then(
          (response) => ({ turnEnded: response }),
          () => ({ rejected: true }),
        ),
        run.closed.then(() => ({ closed: true })),
      ]);
      // A crash is never read as a normal turn end.
      expect(outcome).not.toHaveProperty("turnEnded");
      const { code } = await run.exited;
      expect(code).toEqual(expect.any(Number));
      expect(code).not.toBe(0);
    },
  },
  {
    scenario: "hang",
    play: async (run) => {
      const sessionId = await run.newSession(cwd);
      const prompt = run.prompt(sessionId, "Take your time");
      // A round trip after the prompt: by now the agent has the prompt and must still be holding it.
      await run.newSession(cwd);
      expect(await isSettled(prompt)).toBe(false);
      expect(updatesOf(run)).toEqual([]);

      await run.agent.notify("session/cancel", { sessionId });
      expect((await prompt).stopReason).toBe("cancelled");
    },
  },
  {
    // S7: the desktop e2e's hostile content reaches a client intact, every update in the shared schema.
    scenario: "hostile",
    answer: "allow_once",
    play: async (run) => {
      const response = await run.prompt(await run.newSession(cwd), "Show me everything");
      expect(response.stopReason).toBe("end_turn");
      const sent = JSON.stringify(updatesOf(run));
      expect(sent).toContain(JSON.stringify(HOSTILE.markdown("message")).slice(1, -1));
      expect(sent).toContain(JSON.stringify(HOSTILE.html("plan entry")).slice(1, -1));
      expect(sent.length).toBeGreaterThan(HOSTILE.hugeChars);
      expect(run.received.filter((item) => item.type === "permission")).toHaveLength(2);
      expect(sent).toContain(JSON.stringify(HOSTILE.edit().path).slice(1, -1));
    },
  },
];

describe.each(rows)("fake agent, scenario $scenario", ({ scenario, answer, play }) => {
  test(
    "plays end to end over ACP v1",
    async () => {
      const run = start(scenario, undefined, answer);
      try {
        const init = await run.initialize();
        expect(init.protocolVersion).toBe(1);
        expect(init.agentCapabilities?.loadSession).toBe(false);
        await play(run);
        expect(run.parseFailures).toEqual([]);
      } catch (error) {
        const stderr = run.stderr();
        if (stderr && error instanceof Error) error.message += `\n--- agent stderr ---\n${stderr}`;
        throw error;
      }
    },
    ROW_TIMEOUT_MS,
  );
});

// Lasting check (silent failure): no secret reaches a spawned agent, through the real spawn path.
describe("no secret reaches a spawned agent", () => {
  test(
    "the env scenario reports only allowlisted variable names",
    async () => {
      const source: NodeJS.ProcessEnv = {
        HOME: "/home/dev",
        PATH: process.env.PATH ?? "/usr/bin",
        LANG: "en_US.UTF-8",
        XDG_RUNTIME_DIR: "/run/user/1000",
        WOMBAT_TOKEN: "tok_3f9c2a71e4b8d6051a7c9e2f",
        WOMBAT_PORT: "14900",
        ANTHROPIC_API_KEY: "sk-ant-fake-0000000000000000",
        UNRELATED_SETTING: "on",
      };
      const run = start("env", source);
      await run.initialize();
      const response = await run.prompt(await run.newSession(cwd), "Which variables do you see?");
      expect(response.stopReason).toBe("end_turn");
      expect(run.parseFailures).toEqual([]);

      const text = updatesOf(run)
        .flatMap((update) =>
          update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? [update.content.text] : [],
        )
        .join("");
      const names = JSON.parse(text) as unknown;
      expect(names).toEqual(expect.arrayContaining(["HOME", "PATH"]));
      if (!Array.isArray(names)) throw new Error("the env scenario did not report an array");

      // The fake harness declares nothing, so allowed means allowlisted.
      const allowed = (name: string) => ENV_ALLOWLIST.includes(name) || name.startsWith("XDG_");
      expect(names.filter((name) => typeof name !== "string" || !allowed(name))).toEqual([]);
      for (const secret of ["WOMBAT_TOKEN", "WOMBAT_PORT", "ANTHROPIC_API_KEY", "UNRELATED_SETTING"]) {
        expect(names).not.toContain(secret);
      }
    },
    ROW_TIMEOUT_MS,
  );
});
