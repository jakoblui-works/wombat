import { AgentErrorCode, ConfigOption, selectValues } from "@wombat/shared/api";
import { z } from "zod";

import { canResume } from "../harness/registry.ts";
import { safeName, type Log } from "../log.ts";
import { isGoingAway, type AgentProcess } from "./agent-process.ts";
import type { AgentRecord } from "./agent-record.ts";
import { AgentError, busy, notFound, notRunning, rpcCode, rpcMessage } from "./errors.ts";
import { HIDDEN_BUSY } from "./hidden-turn.ts";
import { endingByService, isBeingRemoved, isHidden } from "./phase.ts";
import type { Proc } from "./proc.ts";
import type { Resume } from "./resume.ts";
import { withTimeout } from "./timeout.ts";

/** How long a config set the user asked for waits for the agent; under the desktop's request timeout, so its answer arrives. */
export const CONFIG_SET_TIMEOUT_MS = 30_000;

export const ConfigOptions = z.array(ConfigOption);

/** Throws `invalid_request` unless `value` is one the option takes: a boolean for a boolean, one of a select's values for a select. */
const checkConfigValue = (option: ConfigOption, value: string | boolean) => {
  const fail = (message: string) => new AgentError("invalid_request", `The config option "${option.id}" ${message}`);
  if (option.type === "boolean") {
    if (typeof value !== "boolean") throw fail("takes true or false. Send one it takes.");
    return;
  }
  if (option.type !== "select" || !("options" in option)) {
    throw fail("is of a type the service can't set. Change it in the agent itself, or leave it as it is.");
  }
  const values = selectValues(option).map((entry) => entry.value);
  if (values.length === 0) throw fail("offers no values to pick from. Leave it as it is, or check that the agent is up to date.");
  if (typeof value !== "string" || !values.includes(value)) throw fail(`takes one of: ${values.join(", ")}. Send one it takes.`);
};

/** Why a config set failed when the agent never answered it. */
const configUnanswered = (configId: string, timeoutMs: number) =>
  new AgentError(
    AgentErrorCode.enum.agent_error,
    `The agent didn't answer the change to "${configId}" within ${timeoutMs / 1000} s, so it may not have taken it. ` +
      "Try again; if it still doesn't answer, stop the agent and send a message to start it again (it keeps its conversation).",
  );

/** Sets one config option, failing with `configUnanswered` when the agent doesn't answer within `timeoutMs`. */
export const setConfigWithin = (proc: Proc, configId: string, value: string | boolean, timeoutMs: number) =>
  withTimeout(proc.acp.setConfigOption(proc.sessionId, configId, value), timeoutMs, () => configUnanswered(configId, timeoutMs));

export type ConfigDeps = {
  log: Log;
  configSetTimeoutMs: number;
  isCurrent: AgentProcess["isCurrent"];
  hasAgent: AgentRecord["hasAgent"];
  appendLog: AgentRecord["appendLog"];
  ensureRunning: Resume["ensureRunning"];
};

/** The agents' config options: set by the user one after another, and stored as the agent reports them. */
export const createConfig = ({ log, configSetTimeoutMs, isCurrent, hasAgent, appendLog, ensureRunning }: ConfigDeps) => {
  // Each process's config sets, one after another: each is checked against the options the one before it stored, and
  // a set's answer never mixes with the next one's request.
  const settings = new WeakMap<Proc, Promise<void>>();

  /** Stores the agent's main-session options as a config_option_update; false when they don't parse. */
  const appendConfig = (proc: Proc, options: unknown[]) => {
    const parsed = ConfigOptions.safeParse(options);
    if (!parsed.success) {
      log("config_invalid", { agentId: proc.agentId });
      return false;
    }
    appendLog(proc, [{ type: "session_update", sessionId: proc.sessionId, update: { sessionUpdate: "config_option_update", configOptions: parsed.data } }]);
    return true;
  };

  /**
   * Sets one of the agent's config options, checked against its latest stored options; returns once the agent's new
   * options are stored. An agent without a process is resumed first (`ensureRunning`). A value the agent refuses fails with `agent_error`, its message carrying the agent's own.
   */
  const setConfig = async (agentId: string, configId: string, value: string | boolean) => {
    // A set on an agent without a process starts it, as a message does.
    const proc = await ensureRunning(agentId);
    const set = (settings.get(proc) ?? Promise.resolve()).then(() => setOne(proc, configId, value));
    settings.set(proc, set.catch(() => undefined));
    return set;
  };

  /** One set on a running agent, after the ones before it (`settings`). */
  const setOne = async (proc: Proc, configId: string, value: string | boolean) => {
    const { agentId } = proc;
    if (endingByService(proc.phase) || !isCurrent(proc)) throw notRunning(canResume(proc.harness));
    if (isHidden(proc.phase)) throw busy(HIDDEN_BUSY);
    const option = proc.config?.find(({ id }) => id === configId);
    if (option === undefined) {
      const ids = (proc.config ?? []).map(({ id }) => id);
      throw new AgentError(
        "invalid_request",
        `The agent has no config option "${configId}". ${ids.length === 0 ? "It offers none." : `Set one of: ${ids.join(", ")}.`}`,
      );
    }
    checkConfigValue(option, value);
    let options: unknown[];
    try {
      options = await setConfigWithin(proc, configId, value, configSetTimeoutMs);
    } catch (error) {
      if (isGoingAway(proc)) throw notRunning(canResume(proc.harness));
      if (error instanceof AgentError) {
        log("config_unanswered", { agentId, configId: safeName(configId) });
        throw error;
      }
      const code = rpcCode(error);
      log("config_refused", { agentId, configId: safeName(configId), code: code ?? -1 });
      const said = rpcMessage(error);
      throw new AgentError(
        AgentErrorCode.enum.agent_error,
        `The agent refused to set "${configId}"${code === undefined ? "" : ` (ACP error ${code})`}; it keeps its current settings. ` +
          `Pick another value, or try again.${said === undefined || said === "" ? "" : ` The agent said: ${said}`}`,
      );
    }
    if (isBeingRemoved(proc.phase) || !hasAgent(agentId)) throw notFound(agentId);
    if (!appendConfig(proc, options)) {
      throw new AgentError(
        AgentErrorCode.enum.agent_error,
        `The agent set "${configId}" but answered with options the service can't read. Check that the agent is up to date, then try again.`,
      );
    }
    log("config_set", { agentId, configId: safeName(configId) });
  };

  return { setConfig, appendConfig };
};

export type Config = ReturnType<typeof createConfig>;
