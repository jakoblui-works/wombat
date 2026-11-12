// The one place that turns main's facts about the agent service (the connection, the agents list, the clock) into what
// the status bar item, its panel and the launch notice say. Those components only render its output.
import { agentCountLabel, agentsWithProcess, type AgentSummary } from "@wombat/shared/api";

import type { ConnectionState } from "../../../shared/bridge.ts";
import { CONNECTION_STATES, type ServiceTone } from "./connection-state.ts";
import { startedClock, uptimeLabel } from "./uptime.ts";

export type { ServiceTone };

export type ServiceView = {
  /** The status bar's service item. */
  item: { text: string; tone: ServiceTone };
  /**
   * What a screen reader is told when it changes: the item without the uptime (the state, stale, the agent count), so
   * the clock ticking doesn't announce anything.
   */
  announcement: string;
  /**
   * The panel: its lines of text (the state, when it started, main's message when not connected, the stale sentence,
   * then what the agents are), and the agents with a process to list after them; `agents` is undefined (shown as
   * unknown) unless connected.
   */
  panel: { lines: readonly string[]; agents: readonly AgentSummary[] | undefined };
  /** The launch notice: its text and whether it offers Restart; undefined when it doesn't show. */
  notice: { text: string; restart: boolean } | undefined;
};

/** What a stale service is told: the panel's line and the notice's second sentence. */
export const STALE_SENTENCE = "This service runs older code than the app. Restart it to use what's new; agents with a process stop.";

const item = (...parts: (string | undefined)[]): string => ["Service", ...parts].filter((part) => part !== undefined).join(" · ");

const agentsLine = (connected: boolean, agents: readonly AgentSummary[] | undefined): string => {
  if (agents === undefined) return connected ? "Agents: not read yet." : "Agents: unknown while the service isn't connected.";
  return agents.length === 0 ? "No agents with a process." : "Agents with a process:";
};

export const serviceView = ({
  connection,
  agents,
  now,
}: {
  connection: ConnectionState;
  agents: readonly AgentSummary[] | undefined;
  now: number;
}): ServiceView => {
  const look = CONNECTION_STATES[connection.state];
  if (connection.state !== "connected") {
    return {
      item: { text: item(look.item.text), tone: look.item.tone },
      announcement: item(look.item.text),
      panel: { lines: [look.line, ...(connection.message === undefined ? [] : [connection.message]), agentsLine(false, undefined)], agents: undefined },
      notice: undefined,
    };
  }

  const { service } = connection;
  const stale = service?.stale === true;
  const startedAt = service?.startedAt;
  const uptime = startedAt === undefined ? undefined : uptimeLabel(startedAt, now);
  // Undefined until the list is read (or when the read failed), so nothing says "0 agents" unread.
  const withProcess = agents === undefined ? undefined : agentsWithProcess(agents);

  const started =
    startedAt !== undefined
      ? `Started ${startedClock(startedAt)} (${String(uptime)} ago)`
      : service === undefined
        ? "Started: unknown"
        : "Started: unknown (this service doesn't report it)";
  const last = stale ? "older than the app" : withProcess && agentCountLabel(withProcess.length);
  const since = startedAt === undefined ? ", which was already running when Wombat started." : ` that has been running since ${startedClock(startedAt)} (${String(uptime)}).`;

  return {
    item: {
      text: item(uptime === undefined ? look.item.text : `${look.item.text} ${uptime}`, last),
      tone: stale ? "warn" : look.item.tone,
    },
    announcement: item(look.item.text, last),
    panel: { lines: [look.line, started, ...(stale ? [STALE_SENTENCE] : []), agentsLine(true, withProcess)], agents: withProcess },
    // A service the app started itself is no news; the one found running at launch is, with or without a start time.
    notice: service?.foundAtLaunch === true ? { text: `Connected to the agent service${since}${stale ? ` ${STALE_SENTENCE}` : ""}`, restart: stale } : undefined,
  };
};
