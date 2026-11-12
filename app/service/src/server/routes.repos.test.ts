// S7 T12 (s7-2): GET /repos answers ListReposResponse with the workspace's folders, behind the port rules.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { ListReposResponse } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { ALL_SCENARIOS, REPO, setup, TEST_TIMEOUT_MS, trackedHarness } from "../../test/manager-fixtures.ts";
import { APP_ORIGIN } from "../../test/server-fixtures.ts";
import { startServer } from "./server.ts";

const TOKEN = "token-of-16-char";

test(
  "GET /repos answers the root, then the git repos; a request without the token is refused",
  async () => {
    const t = setup();
    mkdirSync(join(t.root, REPO, ".git"));
    const server = await startServer({
      manager: t.manager,
      store: t.store,
      harnesses: ALL_SCENARIOS.map((scenario) => trackedHarness(scenario, t.pidDir)),
      workspaceRoot: t.root,
      token: TOKEN,
    });
    try {
      const url = `http://127.0.0.1:${String(server.port)}/repos`;
      const answer = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}`, origin: APP_ORIGIN } });
      expect(answer.status).toBe(200);
      expect(ListReposResponse.parse(await answer.json()).repos).toEqual([
        { path: ".", name: "workspace" },
        { path: REPO, name: REPO },
      ]);
      const refused = await fetch(url, { headers: { origin: APP_ORIGIN } });
      expect(refused.status).toBe(401);
    } finally {
      await server.close();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "GET /repos with a missing workspace root answers repo_not_found, not a 500",
  async () => {
    const t = setup();
    const server = await startServer({
      manager: t.manager,
      store: t.store,
      harnesses: ALL_SCENARIOS.map((scenario) => trackedHarness(scenario, t.pidDir)),
      workspaceRoot: join(t.root, "gone"),
      token: TOKEN,
    });
    try {
      const answer = await fetch(`http://127.0.0.1:${String(server.port)}/repos`, { headers: { authorization: `Bearer ${TOKEN}`, origin: APP_ORIGIN } });
      expect(answer.status).toBe(422);
      expect(((await answer.json()) as { error: { code: string } }).error.code).toBe("repo_not_found");
    } finally {
      await server.close();
    }
  },
  TEST_TIMEOUT_MS,
);
