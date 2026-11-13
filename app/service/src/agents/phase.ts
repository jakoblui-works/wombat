/** Why an agent's process is ending: "stop" keeps the agent (stopped), "remove" writes nothing, "exited" on its own. */
export type EndReason = "stop" | "remove" | "exited";

export type AgentPhase =
  | { readonly kind: "starting" }
  | { readonly kind: "idle" }
  | { readonly kind: "turn" }
  | { readonly kind: "hidden" }
  | {
      readonly kind: "ending";
      readonly why: EndReason;
      readonly recorded: boolean;
      readonly turnOpen: boolean;
      readonly hidden: boolean;
    }
  | { readonly kind: "closed" };

export type PhaseEvent =
  | { readonly type: "recorded" }
  | { readonly type: "turnStarted" }
  | { readonly type: "turnEnded" }
  | { readonly type: "hiddenStarted" }
  | { readonly type: "hiddenEnded" }
  | { readonly type: "endRequested"; readonly why: "stop" | "remove" }
  | { readonly type: "exited" }
  | { readonly type: "closed" };

export const STARTING: AgentPhase = { kind: "starting" };
const IDLE: AgentPhase = { kind: "idle" };
const TURN: AgentPhase = { kind: "turn" };
const HIDDEN: AgentPhase = { kind: "hidden" };
const CLOSED: AgentPhase = { kind: "closed" };

const LIVE_KINDS = ["idle", "turn", "hidden"] as const;
type Live = Extract<AgentPhase, { kind: (typeof LIVE_KINDS)[number] }>;
type Ending = Extract<AgentPhase, { kind: "ending" }>;

const isLive = (phase: AgentPhase): phase is Live => (LIVE_KINDS as readonly string[]).includes(phase.kind);

const endingFrom = (phase: Live, why: EndReason): AgentPhase => ({
  kind: "ending",
  why,
  recorded: true,
  turnOpen: phase.kind === "turn",
  hidden: phase.kind === "hidden",
});

const changed = (phase: Ending, change: Partial<Omit<Ending, "kind">>): AgentPhase => ({ ...phase, ...change });

/** The phase after `event`; an event the phase has no move for leaves it as it is. */
export const next = (phase: AgentPhase, event: PhaseEvent): AgentPhase => {
  if (phase.kind === "closed") return phase;
  if (event.type === "closed") return CLOSED;
  if (phase.kind === "starting") {
    if (event.type === "recorded") return IDLE;
    if (event.type === "endRequested" || event.type === "exited") {
      const why = event.type === "exited" ? "exited" : event.why;
      return { kind: "ending", why, recorded: false, turnOpen: false, hidden: false };
    }
    return phase;
  }
  if (phase.kind === "ending") {
    switch (event.type) {
      case "turnStarted":
        return changed(phase, { turnOpen: true });
      case "turnEnded":
        return changed(phase, { turnOpen: false });
      case "hiddenStarted":
        return changed(phase, { hidden: true });
      case "hiddenEnded":
        return changed(phase, { hidden: false });
      case "endRequested":
        return event.why === "remove" || phase.why === "exited" ? changed(phase, { why: event.why }) : phase;
      case "recorded":
        return changed(phase, { recorded: true });
      case "exited":
        return phase;
      default:
        return unhandled(event);
    }
  }
  switch (event.type) {
    case "turnStarted":
      return phase.kind === "idle" ? TURN : phase;
    case "turnEnded":
      return phase.kind === "turn" ? IDLE : phase;
    case "hiddenStarted":
      return phase.kind === "idle" ? HIDDEN : phase;
    case "hiddenEnded":
      return phase.kind === "hidden" ? IDLE : phase;
    case "endRequested":
      return endingFrom(phase, event.why);
    case "exited":
      return endingFrom(phase, "exited");
    case "recorded":
      return phase;
    default:
      return unhandled(event);
  }
};

const unhandled = (event: never): never => {
  throw new Error(`Unhandled phase event: ${JSON.stringify(event)}`);
};

export const isClosed = (phase: AgentPhase) => phase.kind === "closed";

export const endingByService = (phase: AgentPhase) => phase.kind === "ending" && phase.why !== "exited";

/** Whether a start or resume under way may record its process: not once the service is ending it; one that exited may. */
export const mayRecord = (phase: AgentPhase) => !endingByService(phase);

/** Whether the agent's summary is stored, so what its process sends is stored too; until then its updates are held. */
export const recordsAgent = (phase: AgentPhase) => isLive(phase) || (phase.kind === "ending" && phase.recorded);

/** Recorded and not ended by the service: a process that exited still takes messages, settings and cancels until it closes. */
export const takesCalls = (phase: AgentPhase) => recordsAgent(phase) && !endingByService(phase);

export const isTurnOpen = (phase: AgentPhase) => phase.kind === "turn" || (phase.kind === "ending" && phase.turnOpen);

export const isHidden = (phase: AgentPhase) => phase.kind === "hidden" || (phase.kind === "ending" && phase.hidden);

export const isBeingRemoved = (phase: AgentPhase) => phase.kind === "ending" && phase.why === "remove";

export const mayMintToken = (phase: AgentPhase) => phase.kind === "starting" || isLive(phase);

/** Whether the process closing in `phase` writes the end of its open turn. */
export const writesTurnEndOnClose = (phase: AgentPhase) => recordsAgent(phase) && isTurnOpen(phase) && !isBeingRemoved(phase);

/** The agent's state the process closing in `phase` writes, if any. */
export const stateOnClose = (phase: AgentPhase): "stopped" | "error" | undefined => {
  if (!recordsAgent(phase)) return undefined;
  if (!endingByService(phase)) return "error";
  return phase.kind === "ending" && phase.why === "stop" ? "stopped" : undefined;
};
