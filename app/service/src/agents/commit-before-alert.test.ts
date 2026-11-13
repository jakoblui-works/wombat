// Lasting check (silent failure): commit before alert. Every onCommitted event's seq is already readable,
// through a second connection that sees committed data only, when the listener runs; seqs increase; types
// match what changed; the last event reaches the store's current seq.
import { describe, expect, onTestFinished, test } from "vitest";

import { LogEntry } from "@wombat/shared/api";

import { openStore } from "../store/store.ts";
import { REPO, setup, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";

describe("commit before alert", () => {
  test(
    "every committed event is readable when the listener runs, through start, reply, permission, crash, a skipped update and delete",
    async () => {
      const t = setup();
      const first = await t.manager.start("fake-reply", REPO);
      // Opened once the database exists; WAL lets it read while the manager writes, and only what's committed.
      const reader = openStore({ path: t.storePath });
      onTestFinished(() => {
        try {
          reader.close();
        } catch {
          // Already closed.
        }
      });

      const problems: string[] = [];
      const seen: { seq: number; type: string }[] = [];
      t.manager.onCommitted((event) => {
        const { seq, type } = event;
        const agentId = event.type === "proposal" ? `proposal ${event.proposalId}` : event.agentId;
        const previous = seen.at(-1)?.seq ?? 0;
        seen.push({ seq, type });
        const where = `${type} ${seq} for ${agentId}`;
        if (!(seq > previous)) problems.push(`${where}: not above the previous seq ${previous}`);
        if (reader.currentSeq() < seq) problems.push(`${where}: not committed yet (store at ${reader.currentSeq()})`);
        const listed = reader.listAgents().some((agent) => agent.id === agentId);
        if (type === "log" && !reader.readLog(agentId).entries.some((entry) => entry.seq === seq)) {
          problems.push(`${where}: entry not readable`);
        } else if ((type === "agent_added" || type === "agent_changed") && !listed) {
          problems.push(`${where}: agent not readable`);
        } else if (type === "agent_removed" && listed) {
          problems.push(`${where}: agent still listed`);
        } else if (!["log", "agent_added", "agent_changed", "agent_removed"].includes(type)) {
          problems.push(`${where}: unknown type`);
        }
      });

      await t.manager.send(first.id, { text: "Say hello" });
      await t.turnEnded(first.id);

      const permission = await t.manager.start("fake-permission", REPO);
      await t.manager.send(permission.id, { text: "Edit the notes" });
      await waitFor("a pending permission", () => t.agent(permission.id)?.state === "waiting");
      const request = t.entries(permission.id).find((entry) => entry.type === "permission_requested");
      if (request?.type !== "permission_requested") throw new Error("no permission request");
      t.manager.answer(permission.id, request.requestId, "allow_once");
      await t.turnEnded(permission.id);

      const crash = await t.manager.start("fake-crash", REPO);
      await t.manager.send(crash.id, { text: "Go" });
      await waitFor("the crash recorded", () => t.agent(crash.id)?.state === "error");

      const thinker = await t.manager.start("fake-unknown-update", REPO);
      await t.manager.send(thinker.id, { text: "Think first" });
      await t.turnEnded(thinker.id);

      // What the manager stores is what the shared schema reads, and every timestamp is UTC with Z (the store sorts them as text).
      const isZ = (timestamp: string) => timestamp.endsWith("Z") && new Date(timestamp).toISOString() === timestamp;
      for (const entry of [permission, crash, thinker].flatMap((agent) => t.entries(agent.id))) {
        expect(LogEntry.parse(entry)).toEqual(entry);
        expect(isZ(entry.at), entry.at).toBe(true);
      }

      await t.manager.delete(first.id);

      expect(problems).toEqual([]);
      expect(new Set(seen.map((event) => event.type))).toEqual(
        new Set(["agent_added", "agent_changed", "log", "agent_removed"]),
      );
      expect(seen.at(-1)?.seq).toBe(t.store.currentSeq());
    },
    TEST_TIMEOUT_MS,
  );
});
