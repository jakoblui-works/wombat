import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { ConnectionState } from "../../../../shared/bridge.ts";
import { StatusBar } from "./StatusBar.tsx";

const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const STARTED = new Date(NOW - 375 * 60_000).toISOString();

const item = (connection: ConnectionState, agents: string[] | "unread" = []) => {
  const html = renderToStaticMarkup(<StatusBar connection={connection} agents={agents === "unread" ? undefined : agents} now={NOW} onStop={() => undefined} onRestart={() => undefined} />);
  return /data-testid="connection-indicator".*?<button[^>]*>(.*?)<\/button>/s.exec(html)?.[1]?.replace(/<[^>]*>/g, "");
};
const running = (stale = false): ConnectionState => ({ state: "connected", service: { startedAt: STARTED, stale } });

test("a running service shows its uptime and one agent in the singular", () => {
  expect(item(running(), ["a"])).toBe("Service · running 6 h 15 min · 1 agent");
});

test("several agents are plural, none says so", () => {
  expect(item(running(), ["a", "b"])).toBe("Service · running 6 h 15 min · 2 agents");
  expect(item(running())).toBe("Service · running 6 h 15 min · no agents");
});

test("a stale service is called older than the app", () => {
  expect(item(running(true), ["a"])).toBe("Service · running 6 h 15 min · older than the app");
});

test("connecting and reconnecting say so", () => {
  expect(item({ state: "connecting" })).toBe("Service · connecting…");
  expect(item({ state: "reconnecting" })).toBe("Service · connecting…");
});

test("failed and incompatible say not running", () => {
  expect(item({ state: "failed" })).toBe("Service · not running");
  expect(item({ state: "incompatible" })).toBe("Service · not running");
});

test("a connected service of unknown age shows just running", () => {
  expect(item({ state: "connected" })).toBe("Service · running · age unknown");
  expect(item({ state: "connected", service: { stale: false } })).toBe("Service · running · age unknown");
});

test("an agent list not read leaves the count out instead of saying no agents", () => {
  expect(item(running(), "unread")).toBe("Service · running 6 h 15 min");
});
