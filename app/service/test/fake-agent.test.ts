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

type Row = { scenario: FakeScenario; answer?: "allow_once"; play: (run: AgentUnderTest) => Promise<void> };

const rows: Row[] = [
  {
    // The desktop e2e's hostile content reaches a client intact, every update in the shared schema.
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
