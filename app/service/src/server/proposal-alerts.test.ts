// Proposal alerts keep the alert rules agent alerts follow. Every proposal change
// (stored, approved, conflict, rejected) takes the next seq and is announced only after it is committed, so the
// app reading on another connection sees the new status; on the wire the alert carries ids only (seq, dbId, type,
// proposalId), never the reason, the fields, a title or a handle. A file proposal's path and text stay out of the
// alerts and the service's log too, and the list of proposals carries no content for either target.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import type { Proposal } from "@wombat/shared/proposals";

import { openStore, type Store } from "../store/store.ts";
import { readAt, writeAt } from "../../test/items-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { callTool, serveItemsForStub } from "../../test/mcp-fixtures.ts";

const REASONS = ["Overlap seen again in Zen", "Retry once before failing", "A bug nobody filed yet"];
const NOTES = ["Fixed by the new grid", "Retry once on a timeout"];
const TITLE = "Proposed through the tools";

describe("proposal alerts", () => {
  test(
    "every proposal change is alerted after it is committed, with the next seq, and with ids only on the wire",
    async () => {
      const { s, root, token } = await serveItemsForStub();
      const stream = await s.stream();

      // A second connection that sees committed data only, as the app would.
      const reader = openStore({ path: s.storePath });
      onTestFinished(() => {
        try {
          reader.close();
        } catch {
          // Already closed.
        }
      });
      // The store's proposal read, synchronous like the rest of the store.
      const getProposal = (id: string) => (reader as Store & { getProposal?: (id: string) => Proposal | undefined }).getProposal?.(id);

      const problems: string[] = [];
      const statuses = new Map<string, string[]>();
      let previous = s.store.currentSeq();
      s.manager.onCommitted((event) => {
        const proposalId = (event as { proposalId?: unknown }).proposalId;
        if (event.type !== ("proposal" as string) || typeof proposalId !== "string") return;
        const where = `proposal ${proposalId} at seq ${event.seq}`;
        if (!(event.seq > previous)) problems.push(`${where}: not above the previous seq ${previous}`);
        previous = event.seq;
        if (reader.currentSeq() < event.seq) problems.push(`${where}: not committed yet (store at ${reader.currentSeq()})`);
        const found = getProposal(proposalId);
        if (found === undefined) problems.push(`${where}: not readable`);
        else statuses.set(proposalId, [...(statuses.get(proposalId) ?? []), found.status]);
      });

      const version = async (handle: string) => ((await callTool(s, token, "get_item", { handle })).json as { version: string }).version;
      const proposedId = (answer: { json: unknown }) => (answer.json as { proposed: string }).proposed;

      const approved = proposedId(await callTool(s, token, "propose_update", { handle: "BUG-2", fields: { note: NOTES[0] }, version: await version("BUG-2"), reason: REASONS[0] }));
      const conflicted = proposedId(await callTool(s, token, "propose_update", { handle: "BUG-1", fields: { note: NOTES[1] }, version: await version("BUG-1"), reason: REASONS[1] }));
      const rejected = proposedId(await callTool(s, token, "propose_create", { structure: "bugs", title: TITLE, reason: REASONS[2] }));
      expect((await s.api("POST", `/proposals/${approved}/approve`, { version: 1 })).status).toBe(200);
      const bug1 = "bugs/BUG-1-login-times-out.md";
      writeAt(root, bug1, `${readAt(root, bug1)}\nEdited by hand meanwhile.\n`);
      expect((await s.api("POST", `/proposals/${conflicted}/approve`, { version: 1 })).status).toBe(200);
      expect((await s.api("POST", `/proposals/${rejected}/reject`, {})).status).toBe(200);

      expect(problems).toEqual([]);
      expect(Object.fromEntries(statuses)).toEqual({
        [approved]: ["pending", "applying", "approved"],
        [conflicted]: ["pending", "applying", "conflict"],
        [rejected]: ["pending", "rejected"],
      });
      expect(previous, "the last proposal change is the store's current seq").toBe(s.store.currentSeq());

      await stream.until("six proposal alerts", (current) => current.events().filter((event) => event.data.includes('"proposal"')).length >= 6);
      const alerts = stream
        .events()
        .map((event) => JSON.parse(event.data) as Record<string, unknown>)
        .filter((alert) => alert.type === "proposal");
      for (const alert of alerts) expect(Object.keys(alert).sort()).toEqual(["dbId", "proposalId", "seq", "type"]);
      const raw = stream.raw();
      for (const text of [...REASONS, ...NOTES, TITLE, "BUG-1", "BUG-2"]) expect(raw.includes(text), `${text} on the alert stream`).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a file proposal's path and text reach neither the alerts nor the service's log, and the list carries no content",
    async () => {
      const { s, token } = await serveItemsForStub();
      const stream = await s.stream();
      // In the files' names and texts only, so either shows wherever it leaks.
      const NAME = "quokka";
      const TEXT = "Zanzibar";
      const propose = async (name: string) => {
        const path = join(s.root, `${NAME}-${name}.md`);
        writeFileSync(path, `# ${TEXT} notes\n\nSwap every half hour.\n`);
        const answer = await callTool(s, token, "propose_change", { path, reason: "The rule changed.", edits: [{ old: "half hour", new: `hour, as in ${TEXT}` }] });
        return { path, id: (answer.json as { proposed: string }).proposed };
      };
      const approved = await propose("approved");
      const conflicted = await propose("conflicted");
      const item = await callTool(s, token, "propose_create", { structure: "bugs", title: TITLE, reason: REASONS[2] });
      expect(item.isError, item.text).toBe(false);

      expect((await s.api("POST", `/proposals/${approved.id}/approve`, { version: 1 })).status).toBe(200);
      writeFileSync(conflicted.path, `# ${TEXT} notes\n\nSwap every twenty minutes.\n`);
      expect((await s.api("POST", `/proposals/${conflicted.id}/approve`, { version: 1 })).status).toBe(200);
      const listed = await s.api("GET", "/proposals");

      const rows = (listed.json as { proposals: Record<string, unknown>[] }).proposals;
      expect(rows.map(({ target, status }) => ({ target, status }))).toEqual([
        { target: "file", status: "approved" },
        { target: "file", status: "conflict" },
        { target: "item", status: "pending" },
      ]);
      for (const row of rows) {
        for (const key of ["text", "fields", "current", "versions", "baseVersion", "intent"]) expect(Object.hasOwn(row, key), `a listed ${String(row.target)} proposal carries ${key}`).toBe(false);
      }

      // Proposed, being applied and settled for each file proposal, and the item proposal.
      await stream.until("seven proposal alerts", (current) => current.events().filter((event) => event.data.includes('"proposal"')).length >= 7);
      const alerts = stream
        .events()
        .map((event) => JSON.parse(event.data) as Record<string, unknown>)
        .filter((alert) => alert.type === "proposal");
      for (const alert of alerts) expect(Object.keys(alert).sort()).toEqual(["dbId", "proposalId", "seq", "type"]);
      const log = JSON.stringify(s.logs);
      for (const marker of [NAME, TEXT]) {
        expect(stream.raw().includes(marker), `${marker} on the alert stream`).toBe(false);
        expect(log.includes(marker), `${marker} in the service's log`).toBe(false);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
