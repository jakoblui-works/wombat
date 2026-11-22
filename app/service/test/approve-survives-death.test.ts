// An approve the service dies in writes its target exactly once or not at all. The real service as a process kills
// itself at a named point of an approve (stop-at-entry.ts), then starts again on the same store, workspace and items
// root: before it answers anything it has settled the proposal from what the target holds, so no second approve can
// write again and none is needed for a write that landed.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDiscovery } from "@wombat/shared/discovery";
import { expect, onTestFinished, test } from "vitest";

import { versionOfText } from "../src/items/files.ts";
import type { ApproveStep } from "../src/proposals/apply.ts";
import { createFields } from "../src/proposals/item-target.ts";
import { fileRevision } from "../src/proposals/propose-file.ts";
import { openStore, type Store } from "../src/store/store.ts";
import { ACCESS_FILES, VISIBLE_IDS } from "./access-fixtures.ts";
import { fakeSystemd } from "./fake-systemd.ts";
import { writeAt } from "./items-fixtures.ts";
import { REPO, SERVICE_SLICE, TEST_TIMEOUT_MS, waitFor } from "./manager-fixtures.ts";
import { APP_ORIGIN, expectError, onlyWorkspace, rawRequest, type Response } from "./server-fixtures.ts";
import { WORKSPACE } from "./store-fixtures.ts";

const SERVICE_DIR = join(import.meta.dirname, "..");
/** The real service, killing its own process (SIGKILL) at the approve step WOMBAT_TEST_STOP_AT names. */
const STOP_ENTRY = join(import.meta.dirname, "stop-at-entry.ts");
const PLAIN_ENTRY = join(import.meta.dirname, "service-entry.ts");

type Api = (method: string, path: string, body?: unknown) => Promise<Response>;
type Running = { api: Api; stderr: () => string; exited: () => Promise<{ code: number | null; signal: NodeJS.Signals | null }> };

/** A workspace with the agents' repo and an items root (the access fixture), and a store, for services started one after another. */
const place = () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wombat-death-")));
  const workspace = join(base, "workspace");
  const itemsRoot = join(workspace, "platform-docs", "items");
  const runtimeDir = join(base, "run");
  const pidDir = join(base, "pids");
  const home = join(base, "home");
  mkdirSync(join(workspace, REPO), { recursive: true });
  mkdirSync(runtimeDir, { mode: 0o700 });
  mkdirSync(pidDir);
  mkdirSync(home);
  for (const [path, text] of Object.entries(ACCESS_FILES)) writeAt(itemsRoot, path, text);
  const storePath = join(base, "state", "service.db");
  const discoveryPath = join(runtimeDir, "wombat", "service.json");
  const systemd = fakeSystemd();
  const children: ChildProcess[] = [];
  onTestFinished(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    for (const pid of readdirSync(pidDir).map(Number)) {
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    const touched = systemd.calls().filter(({ args }) => args.some((arg) => arg.includes(SERVICE_SLICE)));
    systemd.remove();
    rmSync(base, { recursive: true, force: true });
    if (touched.length > 0) throw new Error(`a service under test touched the real slice: ${JSON.stringify(touched)}`);
  });

  /** Starts the service and waits for its own discovery file (a killed one leaves its file behind). */
  const start = async (entry: string, extra: NodeJS.ProcessEnv = {}): Promise<Running> => {
    const env: NodeJS.ProcessEnv = {
      PATH: systemd.binDir,
      HOME: home,
      XDG_RUNTIME_DIR: runtimeDir,
      WOMBAT_WORKSPACE: workspace,
      WOMBAT_ITEMS: itemsRoot,
      WOMBAT_STORE: storePath,
      WOMBAT_PORT: "0",
      FAKE_AGENT_PID_DIR: pidDir,
      WOMBAT_TEST_SLICE: `wombattest${randomUUID().replaceAll("-", "")}.slice`,
      ...extra,
    };
    const child = spawn(process.execPath, [entry], { cwd: SERVICE_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout.resume();
    const ended = () => child.exitCode !== null || child.signalCode !== null;
    let found: { port: number; token: string } | undefined;
    await waitFor("the service's discovery file", () => {
      if (ended()) throw new Error(`the service exited before writing its discovery file; stderr:\n${stderr}`);
      const file = readDiscovery(discoveryPath);
      if (file?.pid === child.pid) found = file;
      return found !== undefined;
    });
    const { port, token } = found ?? { port: 0, token: "" };
    return {
      stderr: () => stderr,
      exited: async () => {
        await waitFor("the service to exit", ended);
        return { code: child.exitCode, signal: child.signalCode };
      },
      api: (method, path, body) => rawRequest(port, { method, path, body, headers: { authorization: `Bearer ${token}`, origin: APP_ORIGIN } }),
    };
  };

  return { repo: join(workspace, REPO), itemsRoot, storePath, start };
};

type Place = ReturnType<typeof place>;

const NOTES = "# Pairing notes\n\nDriver and navigator swap every half hour.\n";
const NOTES_EDIT = { oldText: "every half hour", newText: "after each finished test" };
const NOTES_PROPOSED = NOTES.replace(NOTES_EDIT.oldText, NOTES_EDIT.newText);
const BUG_2 = { id: VISIBLE_IDS.bug2, handle: "BUG-2", file: "bugs/BUG-2-hero-caption.md" };
const NEW_BUG_TITLE = "The seed script hangs on an empty database";
const AGENT = "agent-removed-before-the-start";

/** The bug files the fixture didn't write. */
const newBugs = (at: Place) => readdirSync(join(at.itemsRoot, "bugs")).filter((name) => name.endsWith(".md") && !Object.hasOwn(ACCESS_FILES, `bugs/${name}`));

/**
 * A proposal put into the store file before the first start, as the propose tools store it, and how often its write
 * shows on its target (a count above 1 is a second write).
 */
type Target = { propose: (at: Place, store: Store) => string; writes: (at: Place) => number; after?: (at: Place, api: Api, id: string) => Promise<void> };

const TARGETS: Record<string, Target> = {
  "a file edit": {
    propose: (at, store) => {
      writeFileSync(join(at.repo, "pairing-notes.md"), NOTES);
      return store.insertProposal(
        { workspace: WORKSPACE, target: "file", path: join(at.repo, "pairing-notes.md"), binder: null, itemId: null, file: null, kind: "edit", reason: "The rule changed.", baseVersion: versionOfText(NOTES), agentId: AGENT },
        fileRevision({ text: NOTES, source: "file", chain: [] }, { edits: [NOTES_EDIT] }).content,
      ).proposal.id;
    },
    writes: (at) => {
      const text = readFileSync(join(at.repo, "pairing-notes.md"), "utf8");
      expect([NOTES, NOTES_PROPOSED], "the file holds the old text or the proposed one, whole").toContain(text);
      expect(readdirSync(at.repo), "nothing else was left in the folder").toEqual(["pairing-notes.md"]);
      return text === NOTES_PROPOSED ? 1 : 0;
    },
  },
  "an item create": {
    propose: (_at, store) =>
      store.insertProposal(
        { workspace: WORKSPACE, target: "item", path: null, binder: "bugs", itemId: null, file: null, kind: "create", reason: "Seen twice.", baseVersion: null, agentId: AGENT },
        { fields: createFields({ title: NEW_BUG_TITLE }, { note: "Seen on a fresh checkout" }) },
      ).proposal.id,
    writes: (at) => newBugs(at).length,
    after: async (_at, api) => {
      const listed = await api("GET", `/workspaces/${await onlyWorkspace(api)}/binders/bugs/items`);
      const titles = (listed.json as { items: { title: string }[] }).items.map((item) => item.title);
      expect(titles.filter((title) => title === NEW_BUG_TITLE), "exactly one item was made").toHaveLength(1);
      expect(titles).toHaveLength(3);
    },
  },
  "an item delete": {
    propose: (_at, store) =>
      store.insertProposal(
        { workspace: WORKSPACE, target: "item", path: null, binder: "bugs", itemId: BUG_2.id, file: null, kind: "delete", reason: "A duplicate.", baseVersion: versionOfText(ACCESS_FILES[BUG_2.file] ?? ""), agentId: AGENT },
        { fields: {} },
      ).proposal.id,
    writes: (at) => (existsSync(join(at.itemsRoot, BUG_2.file)) ? 0 : 1),
    // The item is gone; the proposal still says which one it was.
    after: async (_at, api, id) => expect(((await api("GET", `/proposals/${id}`)).json as { handle: unknown }).handle).toBe(BUG_2.handle),
  },
};

const CASES: [keyof typeof TARGETS, ApproveStep][] = [
  ["a file edit", "after_applying_commit"],
  ["a file edit", "after_write"],
  ["an item create", "after_write"],
  ["an item delete", "after_write"],
];

test.each(CASES)(
  "%s whose approve the service died in, at %s, is settled at the next start and written exactly once",
  async (name, point) => {
    const target = TARGETS[name] as Target;
    const at = place();
    const store = openStore({ path: at.storePath });
    const id = target.propose(at, store);
    store.close();
    const approve = (api: Api) => api("POST", `/proposals/${id}/approve`, { version: 1 });
    const status = async (api: Api) => ((await api("GET", `/proposals/${id}`)).json as { status?: string }).status;
    const landed = point === "after_write";

    const dying = await at.start(STOP_ENTRY, { WOMBAT_TEST_STOP_AT: point });
    const answer = await approve(dying.api).catch((error: unknown) => error);
    expect(await dying.exited(), `the service killed itself at ${point}; stderr:\n${dying.stderr()}`).toEqual({ code: null, signal: "SIGKILL" });
    expect(answer, "the approve got no answer").toBeInstanceOf(Error);
    expect(target.writes(at), "the write when the service died").toBe(landed ? 1 : 0);

    const service = await at.start(PLAIN_ENTRY);

    // The first request already sees it settled: no further approve was sent.
    expect(await status(service.api), service.stderr()).toBe(landed ? "approved" : "pending");
    expect(target.writes(at), "the start wrote nothing").toBe(landed ? 1 : 0);
    if (landed) expectError(await approve(service.api), 409, "proposal_not_pending", "approving what already landed");
    else expect(((await approve(service.api)).json as { status?: string }).status, "approving the pending proposal").toBe("approved");
    expect(target.writes(at), "written exactly once").toBe(1);
    await target.after?.(at, service.api, id);
  },
  2 * TEST_TIMEOUT_MS,
);

