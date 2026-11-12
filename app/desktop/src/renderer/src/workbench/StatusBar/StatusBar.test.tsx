import type { AgentSummary } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { ConnectionState } from "../../../../shared/bridge.ts";
import { StatusBar } from "./StatusBar.tsx";

const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const STARTED = new Date(NOW - 375 * 60_000).toISOString();

const agent = (id: string, hasProcess = true) => ({ id, repo: "bakery-site", title: `Task ${id}`, state: "working", hasProcess }) as AgentSummary;

const render = (connection: ConnectionState, agents: AgentSummary[] | "unread" = []) =>
  renderToStaticMarkup(<StatusBar connection={connection} agents={agents === "unread" ? undefined : agents} now={NOW} onStop={() => undefined} onRestart={() => undefined} />);
const text = (html: string) => html.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'");
const item = (connection: ConnectionState, agents: AgentSummary[] | "unread" = []) => {
  const button = /data-testid="connection-indicator".*?<button[^>]*>(.*?)<\/button>/s.exec(render(connection, agents))?.[1];
  return button === undefined ? undefined : text(button);
};
const running = (stale = false): ConnectionState => ({ state: "connected", service: { startedAt: STARTED, stale, foundAtLaunch: false } });

test("a running service shows its uptime and the agents with a process, one in the singular", () => {
  expect(item(running(), [agent("a"), agent("b", false)])).toBe("Service · running 6 h 15 min · 1 agent");
});

test("several agents are plural, none is a count of 0", () => {
  expect(item(running(), [agent("a"), agent("b")])).toBe("Service · running 6 h 15 min · 2 agents");
  expect(item(running())).toBe("Service · running 6 h 15 min · 0 agents");
});

test("a stale service is called older than the app", () => {
  expect(item(running(true), [agent("a")])).toBe("Service · running 6 h 15 min · older than the app");
});

test("connecting and reconnecting say so", () => {
  expect(item({ state: "connecting" })).toBe("Service · connecting…");
  expect(item({ state: "reconnecting" })).toBe("Service · connecting…");
});

test("failed says not connected, incompatible that it doesn't match this app", () => {
  expect(item({ state: "failed" })).toBe("Service · not connected");
  expect(item({ state: "incompatible" })).toBe("Service · doesn't match this app");
});

test("a connected service of unknown age shows just running", () => {
  expect(item({ state: "connected" }, "unread")).toBe("Service · running");
  expect(item({ state: "connected", service: { stale: false, foundAtLaunch: false } }, "unread")).toBe("Service · running");
});

test("an agent list not read leaves the count out instead of saying none", () => {
  expect(item(running(), "unread")).toBe("Service · running 6 h 15 min");
});

test("a status live region announces the item without its uptime, so the clock ticking announces nothing", () => {
  const announced = (now: number) => {
    const html = renderToStaticMarkup(<StatusBar connection={running(true)} agents={[agent("a")]} now={now} onStop={() => undefined} onRestart={() => undefined} />);
    return text(/<span role="status"[^>]*>(.*?)<\/span>/s.exec(html)?.[1] ?? "");
  };
  expect(announced(NOW)).toBe("Service · running · older than the app");
  expect(announced(NOW + 5 * 60_000)).toBe(announced(NOW));
});
