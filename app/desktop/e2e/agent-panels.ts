// Helpers for the e2e checks of the agent panels (chat, edit approvals, Needs me), on top of app-fixtures.ts.
// What they rely on in the page: the middle (`main`) shows one chat, its header's `h2` titled after its agent (for a
// fake agent without a title: its repo).
import type { Locator, Page } from "@playwright/test";

import { agentSummary, expect, type Sandbox, waitUntil, WAIT_MS } from "./app-fixtures.ts";

/**
 * The middle while it shows the chat titled `title` (exactly). By element, not role: a modal dialog hides the page
 * from the accessibility tree while it's open.
 */
export const groupWithTab = (page: Page, title: string): Locator =>
  page.locator("main").filter({ has: page.locator("h2", { hasText: new RegExp(`^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) }) });

/** Sends `text` to the agent through the test's own client. */
export const prompt = async (sandbox: Sandbox, agentId: string, text: string): Promise<void> => {
  const sent = await sandbox.api("POST", `/agents/${agentId}/messages`, { text });
  expect(sent.status, `prompt: ${JSON.stringify(sent.json)}`).toBe(202);
};

/** Waits until the service reports the agent in `state`. */
export const waitForState = (sandbox: Sandbox, agentId: string, state: string): Promise<true> =>
  waitUntil(`agent ${agentId} to be ${state}`, WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === state ? true : undefined));

type Entry = { type: string; kind?: string; requestId?: string; update?: { sessionUpdate?: string; status?: string } };

/** The agent's log as the service keeps it. */
export const logOf = async (sandbox: Sandbox, agentId: string): Promise<Entry[]> => {
  const read = await sandbox.api("GET", `/agents/${agentId}/log?after=0&limit=1000`);
  expect(read.status, `log: ${JSON.stringify(read.json)}`).toBe(200);
  return (read.json as { entries: Entry[] }).entries;
};

/** The answers the service recorded, in order (`permission_answered` kinds). */
export const answersIn = (entries: Entry[]): string[] => entries.flatMap((entry) => (entry.type === "permission_answered" && entry.kind ? [entry.kind] : []));
