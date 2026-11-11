// What session/new carries: the Claude Code harness's pre-allowed Wombat tools (D16) as `_meta`, and no `_meta`
// from a harness that sets none.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { claudeCode } from "../harness/claude-code.ts";
import type { Harness } from "../harness/harness.ts";
import { startServer } from "../server/server.ts";
import { openStore } from "../store/store.ts";
import { createManager } from "./manager.ts";

const SDK = import.meta.resolve("@agentclientprotocol/sdk");

/** An ACP agent that writes its session/new params to the file in RECORD_TO. */
const RECORDER = `
import { writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { agent, ndJsonStream } from ${JSON.stringify(SDK)};
agent({ name: "recorder" })
  .onRequest("initialize", () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
  .onRequest("session/new", ({ params }) => {
    writeFileSync(process.env.RECORD_TO, JSON.stringify(params));
    return { sessionId: "session-1" };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
`;

type SessionNew = {
  mcpServers: { type: string; name: string; url: string; headers: { name: string; value: string }[] }[];
  _meta?: unknown;
};

const recorder = (id: string, file: string, sessionMeta?: Record<string, unknown>): Harness => ({
  id,
  name: id,
  loginHint: "No login.",
  spawn: (cwd) => ({
    command: process.execPath,
    args: ["--input-type=module", "--eval", RECORDER],
    cwd,
    env: { PATH: process.env.PATH ?? "", RECORD_TO: file },
  }),
  ...(sessionMeta === undefined ? {} : { sessionMeta }),
});

/** A manager and server on a fresh store, with a recorder harness with and one without `_meta`. */
const start = async () => {
  const base = mkdtempSync(join(tmpdir(), "wombat-session-mcp-"));
  const workspace = join(base, "workspace");
  mkdirSync(join(workspace, "repo"), { recursive: true });
  mkdirSync(join(base, "bin"));
  const store = openStore({ path: join(base, "service.db") });
  const files = { claude: join(base, "claude.json"), plain: join(base, "plain.json") };
  const harnesses = [recorder("with-meta", files.claude, claudeCode.sessionMeta), recorder("plain", files.plain)];
  const manager = createManager({
    store,
    workspaceRoot: workspace,
    harnesses,
    log: () => undefined,
    // No systemd: the agents run without a scope.
    env: { ...process.env, PATH: join(base, "bin") },
    readInstructions: () => Promise.resolve(undefined),
    slice: `wombattest${randomUUID().replaceAll("-", "")}.slice`,
  });
  const server = await startServer({ manager, store, harnesses, token: randomBytes(24).toString("base64url"), log: () => undefined });
  onTestFinished(async () => {
    await server.close();
    await manager.shutdown();
    store.close();
    rmSync(base, { recursive: true, force: true });
  });
  const read = (which: keyof typeof files) => JSON.parse(readFileSync(files[which], "utf8")) as SessionNew;
  return { manager, read };
};

describe("session/new", () => {
  test(
    "carries the Claude Code harness's pre-allowed Wombat tools, and no _meta for a harness without any",
    async () => {
      const { manager, read } = await start();

      await manager.start("with-meta", "repo");
      await manager.start("plain", "repo");

      expect(read("claude")._meta).toEqual({
        claudeCode: { options: { allowedTools: ["mcp__wombat__*"] } },
      });
      expect(read("plain")).not.toHaveProperty("_meta");
    },
    TEST_TIMEOUT_MS,
  );
});
