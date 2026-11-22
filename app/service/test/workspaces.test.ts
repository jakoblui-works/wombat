// One service serves every workspace, as a process (its real start-up wiring, the fake agent on the mcp-config
// scenario). An agent reaches only its own workspace: its Wombat tools list and read only that workspace's binders
// (another workspace's, hidden or not, answer exactly like missing ones) and its prompt carries only that workspace's
// instructions. Rows a store kept from before workspaces existed reach the running service when main adds the folder
// that adopts them: listed, announced, recovered as at a start, and answering messages, without a restart.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentSummary } from "@wombat/shared/api";
import { describe, expect, onTestFinished, test } from "vitest";

import { openStore } from "../src/store/store.ts";
import { writeAt } from "./items-fixtures.ts";
import { REPO, TEST_TIMEOUT_MS, WAIT_MS, waitFor } from "./manager-fixtures.ts";
import { addWorkspace, APP_ORIGIN, openStream, rawRequest, type Stream } from "./server-fixtures.ts";
import { PROMPTED, promptText, startRecorded, startService, type RunningService } from "./service-fixtures.ts";
import { summary } from "./store-fixtures.ts";

type Binder = { id: string; name: string; prefix: string; access: "hidden" | "read"; item: { handle: string; title: string; id: string } };

/** Item files for `binders`, each marked for the instructions unless hidden (a hidden binder can't be). */
const itemFiles = (binders: Binder[]): Record<string, string> =>
  Object.fromEntries(
    binders.flatMap(({ id, name, prefix, access, item }) => [
      [`${id}/_binder.yaml`, `version: 1\nid: ${id}\nname: ${name}\nprefix: ${prefix}\naccess: ${access}\n${access === "hidden" ? "" : "instructions: full\n"}`],
      [`${id}/${item.handle}-note.md`, `---\nid: ${item.id}\nhandle: ${item.handle}\n---\n# ${item.title}\n\nInvented for this test.\n`],
    ]),
  );

const SHOP: Binder[] = [
  { id: "rules", name: "Shop rules", prefix: "SHR", access: "read", item: { handle: "SHR-1", title: "Refunds take two business days", id: "0196f3c2-5a00-7000-8000-000000000001" } },
];
const BLOG: Binder[] = [
  { id: "style", name: "Blog style", prefix: "STY", access: "read", item: { handle: "STY-1", title: "Headlines in sentence case", id: "0196f3c2-5a00-7000-8000-000000000002" } },
  { id: "ledger", name: "Kestrel ledger", prefix: "LDG", access: "hidden", item: { handle: "LDG-1", title: "Kestrel payout", id: "0196f3c2-5a00-7000-8000-000000000003" } },
];

/** A second workspace folder with the agents' repo and its own items folder; removed after the test. */
const secondWorkspace = (files: Record<string, string>) => {
  const base = mkdtempSync(join(tmpdir(), "wombat-second-"));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "blog");
  mkdirSync(join(root, REPO), { recursive: true });
  const itemsRoot = join(base, "blog-items");
  for (const [path, text] of Object.entries(files)) writeAt(itemsRoot, path, text);
  return { root, itemsRoot };
};

/** A Wombat tool called on /mcp with an agent's own token: its text, and whether it was refused. */
const callTool = async (service: RunningService, token: string, name: string, args: Record<string, unknown>) => {
  const response = await rawRequest(service.file.port, {
    method: "POST",
    path: "/mcp",
    headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(response.status, `${name}: ${response.text}`).toBe(200);
  const result = (response.json as { result?: { isError?: boolean; content?: { text?: string }[] } }).result;
  return { refused: result?.isError === true, text: result?.content?.map((block) => block.text ?? "").join("\n") ?? "" };
};

/** Everything of `binders` an agent of another workspace must never see. */
const marksOf = (binders: Binder[]) => binders.flatMap(({ id, name, prefix, item }) => [id, name, `${prefix}-`, item.title]);

/** The checks for an agent of the workspace holding `own`, while `others` are another workspace's binders. */
const expectOnlyOwn = async (service: RunningService, token: string, own: Binder[], others: Binder[], prompt: string | undefined) => {
  const described = await callTool(service, token, "describe_binder", {});
  expect(described.refused, described.text).toBe(false);
  const visible = own.filter((binder) => binder.access !== "hidden");
  const ids = (JSON.parse(described.text) as { id: string }[]).map((binder) => binder.id).sort();
  expect(ids, "the binders the agent can use").toEqual(visible.map((binder) => binder.id).sort());
  for (const { id, item } of visible) {
    const listed = await callTool(service, token, "list_items", { binder: id });
    expect(listed.text, `its own binder ${id}`).toContain(item.handle);
  }

  // An answer about another workspace's binder or item reads exactly as one about a binder or item nobody has.
  const missingBinder = await callTool(service, token, "list_items", { binder: "no-such-binder" });
  const missingItem = await callTool(service, token, "get_item", { handle: "NOPE-404" });
  expect(missingBinder.refused && missingItem.refused, "control: the missing ones are refused").toBe(true);
  for (const { id, item } of others) {
    const binder = await callTool(service, token, "list_items", { binder: id });
    expect({ ...binder, text: binder.text.replaceAll(id, "<asked>") }, `the other workspace's binder ${id}`).toEqual({
      ...missingBinder,
      text: missingBinder.text.replaceAll("no-such-binder", "<asked>"),
    });
    const read = await callTool(service, token, "get_item", { handle: item.handle });
    expect({ ...read, text: read.text.replaceAll(item.handle, "<asked>") }, `the other workspace's item ${item.handle}`).toEqual({
      ...missingItem,
      text: missingItem.text.replaceAll("NOPE-404", "<asked>"),
    });
  }

  expect(prompt, "its prompt").toBeDefined();
  for (const { item } of visible) expect(prompt, "its prompt carries its own instructions").toContain(item.title);
  for (const mark of marksOf(others)) expect(prompt, "its prompt carries nothing of the other workspace").not.toContain(mark);
};

const AGENT_ALERTS = new Set(["agent_added", "agent_changed"]);

const alertedAgents = (stream: Stream) =>
  stream
    .events()
    .filter((event) => event.data !== "")
    .map((event) => JSON.parse(event.data) as { type?: string; agentId?: string })
    .filter((alert) => alert.type !== undefined && AGENT_ALERTS.has(alert.type))
    .map((alert) => alert.agentId);

const listAgents = async (service: RunningService) => {
  const response = await service.api("GET", "/agents");
  expect(response.status, `GET /agents → ${response.text}`).toBe(200);
  return ((response.json as { agents: unknown[] }).agents ?? []).map((agent) => AgentSummary.parse(agent));
};

describe("a service with more than one workspace", () => {
  test(
    "an agent reaches only its own workspace: its tools list and read only its binders, another's (hidden ones included) answer like missing ones, and its prompt carries only its own instructions",
    async () => {
      const service = await startService({ items: itemFiles(SHOP), add: false });
      const blog = secondWorkspace(itemFiles(BLOG));
      const shopId = await addWorkspace(service.api, service.workspace, service.itemsRoot);
      const blogId = await addWorkspace(service.api, blog.root, blog.itemsRoot);

      const inShop = await startRecorded(service, PROMPTED, shopId);
      const inBlog = await startRecorded(service, PROMPTED, blogId);

      await expectOnlyOwn(service, inShop.token, SHOP, BLOG, promptText(inShop.sessionNew));
      await expectOnlyOwn(service, inBlog.token, BLOG, SHOP, promptText(inBlog.sessionNew));
    },
    TEST_TIMEOUT_MS * 2,
  );

  test(
    "agents adopted by a workspace added on a running service are listed, announced and answer a message without a restart, a stored working one shown as stopped",
    async () => {
      // As a store kept them before workspaces existed: no workspace in the summary.
      const stored = {
        working: summary("agent-adopt-working", { harness: PROMPTED, repo: REPO, state: "working", hasProcess: true }),
        stopped: summary("agent-adopt-stopped", { harness: PROMPTED, repo: REPO, state: "stopped", startedAt: "2026-11-09T09:20:00.000Z" }),
      };
      const ids = Object.values(stored).map((row) => row.id);
      const service = await startService({
        add: false,
        seed: (storePath) => {
          const store = openStore({ path: storePath });
          for (const row of Object.values(stored)) store.putAgent(row as AgentSummary);
          store.close();
        },
      });
      const pid = service.file.pid;
      const stream = await openStream(service.file.port, { headers: { authorization: `Bearer ${service.file.token}`, origin: APP_ORIGIN } });
      onTestFinished(() => stream.close());
      expect(stream.status).toBe(200);
      const listedBefore = (await listAgents(service)).map((agent) => agent.id);
      for (const id of ids) expect(listedBefore, `control: ${id} isn't listed before a workspace adopts it`).not.toContain(id);

      const added = await service.api("POST", "/workspaces", { root: service.workspace, adopt: true });
      expect(added.status, `POST /workspaces with adopt → ${added.text}`).toBe(200);
      const workspace = (added.json as { id: string }).id;

      await stream.until("an agent alert for every adopted agent", (current) => ids.every((id) => alertedAgents(current).includes(id)));
      const listed = await listAgents(service);
      for (const id of ids) {
        const agent = listed.find((candidate) => candidate.id === id);
        expect(agent?.workspace, `${id} is listed in the adopting workspace`).toBe(workspace);
        expect(agent?.state, `${id}'s state`).toBe("stopped");
        expect(agent?.hasProcess, `${id} has no process`).toBe(false);
      }

      // The fake agent writes its session params to the file a message names: the adopted agent answers.
      const dir = mkdtempSync(join(tmpdir(), "wombat-adopted-"));
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
      const report = join(dir, "report.json");
      const sent = await service.api("POST", `/agents/${stored.working.id}/messages`, { text: report });
      expect(sent.status, `a message to the adopted agent → ${sent.text}`).toBe(202);
      await waitFor("the adopted agent's answer", () => existsSync(report) && readFileSync(report, "utf8").length > 0);
      expect((JSON.parse(readFileSync(report, "utf8")) as { sessionResume?: { cwd?: string } }).sessionResume?.cwd, "it resumed in its workspace").toBe(
        join(service.workspace, REPO),
      );
      await expect.poll(async () => (await listAgents(service)).find((agent) => agent.id === stored.working.id)?.hasProcess, { timeout: WAIT_MS }).toBe(true);

      expect(service.file.pid, "control: the same service process").toBe(pid);
      expect(process.kill(pid, 0), "the service never restarted").toBe(true);
    },
    TEST_TIMEOUT_MS * 2,
  );
});
