// The items routes on a valid root: shapes, lookup by handle or alias, link values, hidden binders, and the
// refusals, and problems sent with only the shared Problem's keys. My writes through the routes: refused exactly
// when an agent's edit of the same fields is, a stale version refused with nothing written, each write's log line
// naming who wrote it, and a new binder's refusals writing nothing. Invalid items over HTTP are
// items-invalid-visible.test.ts.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { extraProblemKeys, openAccessRoot } from "../../test/access-fixtures.ts";
import { FIXTURE_FILES, IDS, VALID_FILES, writeAt, writeRoot } from "../../test/items-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { callTool, STUB_AGENT, STUB_TOKEN } from "../../test/mcp-fixtures.ts";
import { serve, type Response, type Served } from "../../test/server-fixtures.ts";
import { AccessError } from "../items/refusals.ts";
import { OLD_SETTINGS_FILE, SETTINGS_FILE } from "../items/binders.ts";

const HIDDEN_SETTINGS = `version: 1
id: secrets
name: Secrets
prefix: SEC
access: hidden
`;

describe("items routes", () => {
  test(
    "GET /items/:ref answers the same item for its id, its handle and its alias",
    async () => {
      // BL-1 is also known by its old handle BL-3.
      const s = await serve({ itemsRoot: writeRoot(VALID_FILES) });
      const get = async (ref: string) => {
        const response = await s.api("GET", `/items/${encodeURIComponent(ref)}`);
        expect(response.status, `GET /items/${ref}: ${response.text}`).toBe(200);
        return response.json as { id: string };
      };
      const byHandle = await get("BL-1");
      expect(byHandle.id).toBe(IDS.bl1);
      expect(await get(IDS.bl1), "by id").toStrictEqual(byHandle);
      expect(await get("BL-3"), "by alias").toStrictEqual(byHandle);
      // Another item's id names that item, not the first one found.
      expect((await get(IDS.bl2)).id).toBe(IDS.bl2);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "binders and items are sent with problems that carry only the shared Problem's keys",
    async () => {
      // Every kind of problem: broken settings, a prefix clash with a hidden binder, and one invalid file per way.
      const root = writeRoot({ ...FIXTURE_FILES, [`secrets/${SETTINGS_FILE}`]: HIDDEN_SETTINGS.replace("prefix: SEC", "prefix: BL") });
      const s = await serve({ itemsRoot: root });

      /** A route's JSON as sent (a schema parse would drop extra keys), and the number of problems in it. */
      const sent = async (path: string) => {
        const response = await s.api("GET", path);
        expect(response.status, `${path}: ${response.text}`).toBe(200);
        return { json: response.json, problems: (response.text.match(/"message":/g) ?? []).length };
      };
      const binders = await sent("/binders");
      const listings = (binders.json as { binders: { id: string | null }[] }).binders;
      // The app reads the catalog itself, not an agent's view of it: the user sees hidden binders too.
      expect(JSON.stringify(listings)).toContain("secrets");
      const answers = [{ path: "/binders", ...binders }];
      for (const { id } of listings) {
        if (id === null) continue;
        const items = await sent(`/binders/${id}/items`);
        answers.push({ path: `/binders/${id}/items`, ...items });
        for (const { handle, problems } of (items.json as { items: { handle: string | null; problems: unknown[] }[] }).items) {
          if (handle !== null && problems.length > 0) answers.push({ path: `/items/${handle}`, ...(await sent(`/items/${encodeURIComponent(handle)}`)) });
        }
      }

      expect(answers.find(({ path }) => path === "/binders")?.problems, "binder problems sent").toBeGreaterThan(0);
      expect(answers.filter(({ path }) => path.startsWith("/items/")).length, "items with problems fetched").toBeGreaterThan(0);
      for (const { path, json } of answers) expect(extraProblemKeys(json), path).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

// ---- My writes ----

const WRITE_IDS = {
  tsk1: "0196f3c2-7e10-7000-8000-000000000001",
  int1: "0196f3c2-7e20-7000-8000-000000000001",
  req1: "0196f3c2-7e30-7000-8000-000000000001",
} as const;

/**
 * Invented: an edit binder with every value type and nothing locked (`intake`), the binder its links point to, a
 * propose binder, a hidden binder, a free binder whose include reaches `howtos/`, and a folder with the old settings file.
 */
const WRITE_FILES: Record<string, string> = {
  [`work/tasks/${SETTINGS_FILE}`]: `version: 1
id: tasks
name: Tasks
prefix: TSK
access: edit
`,
  "work/tasks/TSK-1-rotate-staging-cert.md": `---
id: ${WRITE_IDS.tsk1}
handle: TSK-1
---
# Rotate the staging certificate

The current one expires on the 9th.
`,
  [`intake/${SETTINGS_FILE}`]: `version: 1
id: intake
name: Intake
prefix: INT
access: edit
properties:
  area: { type: select, options: [site, api, infra] }
  effort: { type: number }
  wanted: { type: date }
  task: { type: link, to: tasks }
`,
  "intake/INT-1-export-to-csv.md": `---
id: ${WRITE_IDS.int1}
handle: INT-1
area: api
effort: 1
---
# Export the report to CSV

Finance wants the monthly numbers in a spreadsheet.
`,
  [`requests/${SETTINGS_FILE}`]: `version: 1
id: requests
name: Requests
prefix: REQ
access: propose
properties:
  note: { type: text }
`,
  "requests/REQ-1-dark-mode-docs.md": `---
id: ${WRITE_IDS.req1}
handle: REQ-1
---
# Dark mode for the docs site

Readers asked for it twice this month.
`,
  [`vault/${SETTINGS_FILE}`]: `version: 1
id: vault
name: Vault
prefix: VLT
access: hidden
`,
  [`guides/${SETTINGS_FILE}`]: `version: 1
id: guides
name: Guides
prefix: GD
access: read
naming: free
include: ["*.md", "howtos/**/*.md"]
`,
  [`legacy/${OLD_SETTINGS_FILE}`]: `name: Legacy
prefix: LEG
`,
};

const INT1_PATH = "intake/INT-1-export-to-csv.md";

type Problem = { field?: string; message: string };
type ErrorBody = { error?: { code?: string; problems?: Problem[] } };

const errorOf = (response: Response) => (response.json as ErrorBody | undefined)?.error ?? {};

/** Problems as field and message only, in one order, so two lists compare whatever order they were found in. */
const byField = (problems: readonly Problem[]) =>
  problems.map(({ field, message }) => ({ field, message })).sort((a, b) => `${String(a.field)}\n${a.message}`.localeCompare(`${String(b.field)}\n${b.message}`));

/** A write's outcome as a comparison needs it: written, or refused with a code and its problems. */
type Outcome = { written: true } | { written: false; code: string | undefined; problems: ReturnType<typeof byField> };

const routeOutcome = (response: Response, okStatus: number): Outcome => {
  expect(extraProblemKeys(response.json), response.text).toEqual([]);
  if (response.status === okStatus) return { written: true };
  const { code, problems = [] } = errorOf(response);
  return { written: false, code, problems: byField(problems) };
};

const agentOutcome = async (write: Promise<unknown>): Promise<Outcome> => {
  try {
    await write;
    return { written: true };
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return { written: false, code: error.code, problems: byField(error.problems) };
  }
};

const versionOf = async (s: Served, ref: string) => {
  const response = await s.api("GET", `/items/${encodeURIComponent(ref)}`);
  expect(response.status, response.text).toBe(200);
  return (response.json as { version: string }).version;
};

const VALUE_CASES: { what: string; properties: Record<string, unknown> }[] = [
  { what: "valid values, a link by handle", properties: { area: "infra", effort: 3, wanted: "2027-03-01", task: "TSK-1" } },
  { what: "an option the select doesn't list", properties: { area: "mobile" } },
  { what: "a date that doesn't exist", properties: { wanted: "2027-02-30" } },
  { what: "a number as text", properties: { effort: "three" } },
  { what: "a link to an item that doesn't exist", properties: { task: "TSK-99" } },
];

describe("my item writes", () => {
  test.each(VALUE_CASES)(
    "$what: PATCH and POST are refused exactly when an agent's edit of the same fields is, with the same problems",
    async ({ properties }) => {
      const s = await serve({ itemsRoot: writeRoot(WRITE_FILES) });
      const agent = openAccessRoot(WRITE_FILES);

      /**
       * Mine is refused exactly when the agent's is, and as invalid_fields at the fields given. The problems are the
       * agent's, except where the agent is told a link names nothing it can see (a hidden item reads as a missing one).
       */
      const expectSame = (mine: Outcome, theirs: Outcome, what: string) => {
        expect(mine.written, `${what}: written by me and by the agent alike`).toBe(theirs.written);
        if (mine.written || theirs.written) return;
        expect(mine.code, what).toBe("invalid_fields");
        expect(mine.problems.map(({ field }) => field).sort(), `${what}: my problems at the fields given`).toEqual(Object.keys(properties).sort());
        if (theirs.code === "invalid_fields") expect(mine.problems, `${what}: the agent's problems`).toEqual(theirs.problems);
      };

      const mineUpdate = routeOutcome(await s.api("PATCH", "/items/INT-1", { version: await versionOf(s, "INT-1"), fields: properties }), 200);
      const agentUpdate = await agentOutcome(agent.access.update("agent-intake", "INT-1", properties, (await agent.access.get("INT-1")).version));
      expectSame(mineUpdate, agentUpdate, "PATCH against update_item");

      const input = { title: "Status badges in the README", body: "", properties };
      const mineCreate = routeOutcome(await s.api("POST", "/binders/intake/items", input), 201);
      const agentCreate = await agentOutcome(agent.access.create("agent-intake", "intake", input));
      expectSame(mineCreate, agentCreate, "POST against create_item");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a PATCH or DELETE at a version the file has moved on from is 409 stale_version, and the file stays byte for byte",
    async () => {
      const root = writeRoot(WRITE_FILES);
      const s = await serve({ itemsRoot: root });
      const read = await versionOf(s, "INT-1");
      const handEdited = readFileSync(join(root, INT1_PATH), "utf8").replace("in a spreadsheet.", "in a spreadsheet, by the 5th.");
      writeFileSync(join(root, INT1_PATH), handEdited);

      for (const [what, response] of [
        ["PATCH", await s.api("PATCH", "/items/INT-1", { version: read, fields: { area: "site" } })],
        ["DELETE", await s.api("DELETE", `/items/INT-1?version=${encodeURIComponent(read)}`)],
      ] as const) {
        expect(response.status, `${what}: ${response.text}`).toBe(409);
        expect(errorOf(response).code, `${what}: ${response.text}`).toBe("stale_version");
        expect(readFileSync(join(root, INT1_PATH), "utf8"), `${what}: the file as edited by hand`).toBe(handEdited);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "each write's log line names who wrote it: me through the routes, the agent for its own write and for its approved proposal",
    async () => {
      const s = await serve({ itemsRoot: writeRoot(WRITE_FILES), agentTokens: { [STUB_TOKEN]: STUB_AGENT } });
      const WRITES = new Set(["item_created", "item_updated", "item_deleted"]);
      /** The Writer's lines `write` added, each as its event and author. */
      const authors = async (write: () => Promise<unknown>) => {
        const before = s.logs.length;
        await write();
        return s.logs
          .slice(before)
          .filter(({ event }) => WRITES.has(event))
          .map(({ event, fields }) => ({ event, by: fields.by }));
      };
      const ok = (status: number) => (response: Response) => {
        expect(response.status, response.text).toBe(status);
      };

      expect(await authors(async () => ok(201)(await s.api("POST", "/binders/intake/items", { title: "Search in the docs", body: "", properties: {} }))), "my create").toEqual([
        { event: "item_created", by: "me" },
      ]);
      expect(await authors(async () => ok(200)(await s.api("PATCH", "/items/INT-1", { version: await versionOf(s, "INT-1"), fields: { effort: 2 } }))), "my update").toEqual([
        { event: "item_updated", by: "me" },
      ]);
      expect(await authors(async () => ok(204)(await s.api("DELETE", `/items/INT-1?version=${encodeURIComponent(await versionOf(s, "INT-1"))}`))), "my delete").toEqual([
        { event: "item_deleted", by: "me" },
      ]);

      const tool = async (name: string, args: Record<string, unknown>) => {
        const answer = await callTool(s, STUB_TOKEN, name, args);
        expect(answer.isError, `${name}: ${answer.text}`).toBe(false);
        return answer.json as Record<string, unknown>;
      };
      const tskVersion = (await tool("get_item", { handle: "TSK-1" })).version;
      expect(await authors(() => tool("update_item", { handle: "TSK-1", fields: { title: "Rotate the staging and preview certificates" }, version: tskVersion })), "the agent's update").toEqual([
        { event: "item_updated", by: STUB_AGENT },
      ]);

      const reqVersion = (await tool("get_item", { handle: "REQ-1" })).version;
      const proposed = await tool("propose_update", { handle: "REQ-1", fields: { note: "Use the theme tokens" }, version: reqVersion, reason: "Keeps it consistent." });
      const approve = async () => ok(200)(await s.api("POST", `/proposals/${encodeURIComponent(String(proposed.proposed))}/approve`, { version: 1 }));
      expect(await authors(approve), "my approval of the agent's proposal").toEqual([{ event: "item_updated", by: STUB_AGENT }]);
    },
    TEST_TIMEOUT_MS,
  );
});

// ---- A new binder ----

/** Every file and folder under `dir` (folders ending in "/"), each file with its contents. */
const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (at: string, rel: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        out[`${path}/`] = "";
        walk(join(at, entry.name), path);
      } else out[path] = readFileSync(join(at, entry.name), "utf8");
    }
  };
  walk(dir, "");
  return out;
};

describe("POST /binders", () => {
  test(
    "refuses a taken id or prefix (a hidden binder's too), a folder that is a binder already, a path outside the root, and a folder a free binder's include reaches, writing nothing",
    async () => {
      // The root in a folder of its own, so nothing else writes beside it.
      const outside = writeRoot({});
      const root = join(outside, "items");
      for (const [path, text] of Object.entries(WRITE_FILES)) writeAt(root, path, text);
      const s = await serve({ itemsRoot: root });
      const before = tree(root);
      const besideBefore = readdirSync(outside).sort();

      const refusals: { what: string; body: { path: string; name: string; prefix: string }; field: string }[] = [
        { what: "the id of a visible binder", body: { path: "other/tasks", name: "Tasks", prefix: "OTH" }, field: "name" },
        { what: "the id of a hidden binder", body: { path: "other/vault", name: "Vault", prefix: "OTH" }, field: "name" },
        { what: "the prefix of a visible binder", body: { path: "other/chores", name: "Chores", prefix: "TSK" }, field: "prefix" },
        { what: "the prefix of a hidden binder", body: { path: "other/chores", name: "Chores", prefix: "VLT" }, field: "prefix" },
        { what: `a folder with a ${SETTINGS_FILE}`, body: { path: "intake", name: "Chores", prefix: "CHORE" }, field: "path" },
        { what: `a folder with a ${OLD_SETTINGS_FILE}`, body: { path: "legacy", name: "Chores", prefix: "CHORE" }, field: "path" },
        { what: "a folder a free binder's include reaches", body: { path: "guides/howtos/recipes", name: "Recipes", prefix: "RCP" }, field: "path" },
        { what: "a path above the root", body: { path: "../escaped", name: "Escaped", prefix: "ESC" }, field: "path" },
        { what: "an absolute path outside the root", body: { path: join(outside, "escaped"), name: "Escaped", prefix: "ESC" }, field: "path" },
        { what: "a path that climbs out of the root", body: { path: "work/../../escaped", name: "Escaped", prefix: "ESC" }, field: "path" },
      ];
      for (const { what, body, field } of refusals) {
        const response = await s.api("POST", "/binders", body);
        expect(response.status, `${what}: ${response.text}`).toBe(400);
        expect(errorOf(response).code, `${what}: ${response.text}`).toBe("invalid_fields");
        expect((errorOf(response).problems ?? []).map((problem) => problem.field), `${what}: ${response.text}`).toContain(field);
        expect(tree(root), `${what}: nothing written under the root, nothing overwritten`).toStrictEqual(before);
        expect(readdirSync(outside).sort(), `${what}: nothing written beside the root`).toEqual(besideBefore);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
