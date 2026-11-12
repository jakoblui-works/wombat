// A start's two steps report apart: once POST /agents made the agent, a failed first message comes back beside it
// instead of failing the start, so the message is retried to that agent and no second one is started.
import { afterEach, expect, test, vi } from "vitest";

import { summary } from "../../../../test/log-entries.ts";
import { startAgentFn, startAgentVars } from "./commands.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const service = (messageStatus: number) => {
  const paths: string[] = [];
  vi.stubGlobal("window", {
    wombat: {
      service: {
        request: (method: string, path: string) => {
          paths.push(`${method} ${path}`);
          if (path === "/agents") return Promise.resolve({ status: 201, body: summary("agent-bakery-1", { state: "working" }) });
          return Promise.resolve(
            messageStatus === 202 ? { status: 202, body: { seq: 1 } } : { status: messageStatus, body: { error: { code: "internal_error", message: "Lost." } } },
          );
        },
      },
    },
  });
  return paths;
};

test("a first message that fails comes back as sendError beside the agent that started", async () => {
  const paths = service(500);

  const started = await startAgentFn(startAgentVars({ harness: "fake-reply", repo: ".", text: "Fix the hours" }));

  expect(started.agent.id).toBe("agent-bakery-1");
  expect(started.sendError?.message).toBe("Lost.");
  expect(paths).toEqual(["POST /agents", "POST /agents/agent-bakery-1/messages"]);
});

test("a start that didn't make the agent rejects", async () => {
  vi.stubGlobal("window", {
    wombat: {
      service: {
        request: () => Promise.resolve({ status: 400, body: { error: { code: "repo_not_found", message: "No folder site-web." } } }),
      },
    },
  });

  await expect(startAgentFn(startAgentVars({ harness: "fake-reply", repo: "site-web", text: "Fix the hours" }))).rejects.toThrow("No folder site-web.");
});
