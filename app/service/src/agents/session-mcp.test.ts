// session/resume carries the same session params as session/new.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { fakeHarness } from "../../test/fake-harness.ts";
import { TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { claudeCode } from "../harness/claude-code.ts";
import type { Harness } from "../harness/harness.ts";
import { startServer } from "../server/server.ts";
import { openStore } from "../store/store.ts";
import { createManager } from "./manager.ts";

type Reported = {
  sessionNew?: Record<string, unknown>;
  sessionResume?: Record<string, unknown>;
  sessionId?: string;
};

const wombatUrl = (params: Record<string, unknown> | undefined) =>
  (params?.mcpServers as { name: string; url: string }[] | undefined)?.find((entry) => entry.name === "wombat")?.url;

/**
 * A manager and server with one resumable harness on the fake agent's mcp-config scenario that sets `_meta` and asks
 * for the instructions as Claude Code does; `instructions` is what the next read of them returns.
 */
const startResumable = async () => {
  const base = mkdtempSync(join(tmpdir(), "wombat-session-resume-"));
  const workspace = join(base, "workspace");
  mkdirSync(join(workspace, "repo"), { recursive: true });
  mkdirSync(join(base, "bin"));
  const store = openStore({ path: join(base, "service.db") });
  const harness: Harness = {
    ...fakeHarness("mcp-config"),
    id: "resumable-with-meta",
    ...(claudeCode.sessionMeta === undefined ? {} : { sessionMeta: claudeCode.sessionMeta }),
    ...(claudeCode.sessionParams === undefined ? {} : { sessionParams: claudeCode.sessionParams }),
  };
  const instructions = { now: "Bakery site: keep the opening hours in one place." };
  const manager = createManager({
    store,
    workspaceRoot: workspace,
    harnesses: [harness],
    log: () => undefined,
    env: { ...process.env, PATH: join(base, "bin") },
    readInstructions: () => Promise.resolve(instructions.now),
    slice: `wombattest${randomUUID().replaceAll("-", "")}.slice`,
  });
  const server = await startServer({ manager, store, harnesses: [harness], workspaceRoot: workspace, token: randomBytes(24).toString("base64url"), log: () => undefined });
  onTestFinished(async () => {
    await server.close();
    await manager.shutdown();
    store.close();
    rmSync(base, { recursive: true, force: true });
  });
  let reports = 0;
  /** Sends the agent a report path and returns what it reported (its session params, raw from the wire). */
  const report = async (agentId: string): Promise<Reported> => {
    const ended = () => store.readLog(agentId).entries.filter((entry) => entry.type === "turn_ended").length;
    const before = ended();
    reports += 1;
    const file = join(base, `report-${String(reports)}.json`);
    await manager.send(agentId, { text: file });
    await waitFor("the report's turn to end", () => ended() > before);
    return JSON.parse(readFileSync(file, "utf8")) as Reported;
  };
  return { manager, store, harness, instructions, report };
};

describe("session/resume", () => {
  test(
    "carries the stored session id, the same cwd, _meta and wombat /mcp server as session/new, and the instructions as they are now",
    async () => {
      const { manager, store, harness, instructions, report } = await startResumable();
      const { id } = await manager.start(harness.id, "repo");
      const started = await report(id);
      await manager.stop(id);
      instructions.now = "Bakery site: the opening hours now live in hours.md.";
      const resumed = await report(id);

      const sessionNew = started.sessionNew;
      const resume = resumed.sessionResume;
      expect(sessionNew, "control: the first process got session/new").toBeDefined();
      expect(resume, "the second process got session/resume").toBeDefined();
      expect(resumed.sessionNew, "and no session/new").toBeUndefined();
      expect(resume?.sessionId, "the stored session").toBe(store.listAgents().find((agent) => agent.id === id)?.sessionId);
      expect(resume?.sessionId).toBe(started.sessionId);
      expect(resumed.sessionId, "the prompt runs in it").toBe(started.sessionId);
      expect(resume?.cwd).toBe(sessionNew?.cwd);
      expect(resume?._meta, "the harness's _meta").toEqual(sessionNew?._meta);
      expect(sessionNew?._meta, "control: there is a _meta to carry").toBeDefined();
      expect(wombatUrl(resume), "the wombat /mcp server").toBe(wombatUrl(sessionNew));
      expect(wombatUrl(sessionNew), "control: session/new had one").toBeDefined();
      expect(resume?.systemPrompt, "the instructions read at the resume").toEqual(harness.sessionParams?.(instructions.now).systemPrompt);
    },
    TEST_TIMEOUT_MS,
  );
});
