// What the page says about the agent service, from main's facts alone: the status bar item tells the truth in every
// state, the agents are listed only while they can be known, and the launch notice shows exactly for a service this
// launch found running (a service from before startedAt was reported included: that is the one nobody knew about).
import type { AgentSummary } from "@wombat/shared/api";
import { expect, test } from "vitest";

import type { ConnectionState } from "../../../shared/bridge.ts";
import { serviceView } from "./service-view.ts";

const NOW = Date.parse("2026-11-12T17:49:00.000Z");
/** 6 h 15 min before NOW. */
const STARTED = "2026-11-12T11:34:00.000Z";

// Invented agents: one with a process, one whose process has exited.
const WORKING = { id: "agt_7f3a", repo: "bakery-site", title: "Tidy the opening hours", state: "working", hasProcess: true } as AgentSummary;
const STOPPED = { id: "agt_19c2", repo: "bakery-site", title: "Old menu page", state: "stopped", hasProcess: false } as AgentSummary;
const AGENTS = [WORKING, STOPPED];

const connected = (service: { startedAt?: string; stale: boolean; foundAtLaunch: boolean }): ConnectionState =>
  ({ state: "connected", service });
const FRESH = connected({ startedAt: STARTED, stale: false, foundAtLaunch: false });
const STALE = connected({ startedAt: STARTED, stale: true, foundAtLaunch: false });
const FAILED_MESSAGE = "The service stopped, or kept dropping the connection, for 30 s. Restart it to start it again.";
const NOT_CONNECTED: [string, ConnectionState][] = [
  ["connecting", { state: "connecting" }],
  ["reconnecting", { state: "reconnecting" }],
  ["failed", { state: "failed", message: FAILED_MESSAGE }],
  ["incompatible", { state: "incompatible", message: "The running service speaks API version 2; this app needs version 1." }],
];

const view = (connection: ConnectionState, agents: readonly AgentSummary[] | undefined = AGENTS) => serviceView({ connection, agents, now: NOW });
/** Before the agent list has been read. */
const unread = (connection: ConnectionState) => serviceView({ connection, agents: undefined, now: NOW });

test("the panel lists the agents with a process while connected, and none (unknown) otherwise or before the list is read", () => {
  expect(view(FRESH).panel.agents?.map(({ id }) => id)).toEqual([WORKING.id]);
  expect(unread(FRESH).panel.agents, "an unread list shown as known").toBeUndefined();
  expect(unread(FRESH).item.text, "an unread list shown as no agents").not.toMatch(/no agents/);
  for (const [name, connection] of NOT_CONNECTED) {
    expect(view(connection).panel.agents, `agents listed while ${name}`).toBeUndefined();
  }
});

test("the item says what each state is: running, older than the app, doesn't match this app, not connected (with main's message), connecting", () => {
  const fresh = view(FRESH).item;
  expect(fresh.text).toMatch(/running/);
  expect(fresh.text).toContain("6 h 15 min");
  expect(fresh.text).toMatch(/\b1 agent\b/);
  expect(fresh.text).not.toMatch(/older than the app/);
  expect(view(FRESH, [WORKING, { ...WORKING, id: "agt_2b9d" }]).item.text).toMatch(/\b2 agents\b/);

  const stale = view(STALE).item;
  expect(stale.text).toMatch(/older than the app/);
  expect(stale.tone, "stale looks like a running service").not.toBe(fresh.tone);

  const incompatible = view(NOT_CONNECTED[3]![1]).item;
  expect(incompatible.text).toMatch(/doesn't match this app/);
  expect(incompatible.tone, "incompatible isn't amber like stale").toBe(stale.tone);

  const failed = view(NOT_CONNECTED[2]![1]);
  expect(failed.item.text).toMatch(/not connected/);
  expect(failed.item.text, "a service that can't be reached isn't known to be not running").not.toMatch(/not running/);
  expect([fresh.tone, stale.tone], "failed looks like a running service").not.toContain(failed.item.tone);
  expect(failed.panel.lines.join("\n"), "the panel doesn't say why it failed").toContain(FAILED_MESSAGE);

  for (const connection of [NOT_CONNECTED[0]![1], NOT_CONNECTED[1]![1]]) {
    const item = view(connection).item;
    expect(item.text, connection.state).toMatch(/connecting…/);
    expect(item.tone, `${connection.state} looks like a running service`).not.toBe(fresh.tone);
  }
});

test("the launch notice shows exactly for a service found running at launch; without a start time it leaves the time out and keeps Restart", () => {
  expect(view(FRESH).notice, "a service the app started is announced").toBeUndefined();
  expect(view(STALE).notice, "a stale service the app started is announced").toBeUndefined();
  for (const [name, connection] of NOT_CONNECTED) expect(view(connection).notice, `announced while ${name}`).toBeUndefined();

  const found = view(connected({ startedAt: STARTED, stale: false, foundAtLaunch: true })).notice;
  expect(found, "a service found at launch isn't announced").toBeDefined();
  expect(found?.text).toMatch(/since/);
  expect(found?.text).toContain("6 h 15 min");

  const foundStale = view(connected({ startedAt: STARTED, stale: true, foundAtLaunch: true }));
  expect(foundStale.notice?.restart).toBe(true);
  // One stale sentence: the panel's is the notice's.
  const staleLine = view(STALE).panel.lines.find((line) => /older code than the app/.test(line));
  expect(staleLine, "the stale panel has no stale sentence").toBeDefined();
  expect(foundStale.notice?.text).toContain(staleLine);

  // A service from before startedAt and codeId were reported: stale, its start unknown.
  const preChange = view(connected({ stale: true, foundAtLaunch: true })).notice;
  expect(preChange, "the pre-change service isn't announced").toBeDefined();
  expect(preChange?.text, "the notice names a time it can't know").not.toMatch(/since|\d:\d\d|\bmin\b|\bh\b|undefined|NaN/);
  expect(preChange?.restart, "the pre-change service's notice has no Restart").toBe(true);
});
