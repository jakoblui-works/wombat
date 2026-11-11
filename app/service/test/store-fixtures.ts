// Shared setup for the store tests: a temp database path, a fake clock, and invented but realistic
// agent summaries and entries.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentSummary } from "@wombat/shared/api";
import { onTestFinished } from "vitest";

import { openStore, type NewLogEntry } from "../src/store/store.ts";

export type Store = ReturnType<typeof openStore>;
export type StoreOptions = Parameters<typeof openStore>[0];

/** A fresh temp folder, removed after the test. */
export const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "wombat-store-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A database path inside a folder that doesn't exist yet, as on a first start. */
export const tempStorePath = (dir = tempDir()) => join(dir, "state", "wombat", "service.db");

/** A clock that moves one second per call. */
export const fakeClock = (start = "2026-11-09T10:00:00.000Z") => {
  let time = Date.parse(start);
  return () => new Date((time += 1000));
};

/** Opens a store and closes it after the test, unless the test closed it already. */
export const open = (options: StoreOptions): Store => {
  const store = openStore(options);
  onTestFinished(() => {
    try {
      store.close();
    } catch {
      // Already closed by the test.
    }
  });
  return store;
};

export const summary = (id: string, overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  id,
  harness: "claude-code",
  repo: "site-web",
  state: "done",
  sessionId: `sess-${id}`,
  capabilities: { loadSession: false },
  startedAt: "2026-11-09T09:00:00.000Z",
  lastActivityAt: "2026-11-09T09:05:00.000Z",
  pendingPermissions: [],
  ...overrides,
});

export const textChunk = (text: string, at?: string): NewLogEntry => ({
  type: "session_update",
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  ...(at === undefined ? {} : { at }),
});

/** One of each entry type, as a turn with a permission request would produce them. */
export const realisticTurn: NewLogEntry[] = [
  { type: "user_message", text: "Rename the footer link to Imprint", commandId: "cmd_01", at: "2026-11-09T09:01:00.000Z" },
  textChunk("I'll update the footer component.", "2026-11-09T09:01:01.000Z"),
  {
    type: "session_update",
    at: "2026-11-09T09:01:02.000Z",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "tc_1",
      title: "Edit src/Footer.tsx",
      kind: "edit",
      status: "pending",
      content: [{ type: "diff", path: "src/Footer.tsx", oldText: "<a>Legal</a>", newText: "<a>Imprint</a>" }],
    },
  },
  {
    type: "permission_requested",
    at: "2026-11-09T09:01:03.000Z",
    requestId: "perm_1",
    toolCall: { toolCallId: "tc_1", title: "Edit src/Footer.tsx" },
    options: [
      { kind: "allow_once", name: "Allow" },
      { kind: "reject_once", name: "Reject" },
    ],
  },
  { type: "permission_answered", at: "2026-11-09T09:01:09.000Z", requestId: "perm_1", kind: "allow_once" },
  {
    type: "session_update",
    at: "2026-11-09T09:01:10.000Z",
    update: { sessionUpdate: "tool_call_update", toolCallId: "tc_1", status: "completed" },
  },
  { type: "turn_ended", at: "2026-11-09T09:01:11.000Z", stopReason: "end_turn" },
];
