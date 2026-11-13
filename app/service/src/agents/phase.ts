/** Why an agent's process is ending: "stop" keeps the agent (stopped), "remove" writes nothing, "exited" on its own. */
export type EndReason = "stop" | "remove" | "exited";

export type AgentPhase =
  | { readonly kind: "starting" }
  | { readonly kind: "idle" }
  | { readonly kind: "turn" }
  | { readonly kind: "hidden" }
  | { readonly kind: "ending"; readonly why: EndReason; readonly turnOpen: boolean; readonly hidden: boolean }
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

type Live = Extract<AgentPhase, { kind: "idle" | "turn" | "hidden" }>;
type Ending = Extract<AgentPhase, { kind: "ending" }>;

const endingFrom = (phase: Live, why: EndReason): AgentPhase => ({
  kind: "ending",
  why,
  turnOpen: phase.kind === "turn",
  hidden: phase.kind === "hidden",
});

const changed = (phase: Ending, change: Partial<Omit<Ending, "kind">>): AgentPhase => ({ ...phase, ...change });

/**
 * The phase after `event`; an event the phase has no move for leaves it as it is. A process ended before it was
 * recorded ends as "remove": nothing of it is stored, so its close writes nothing.
 */
export const next = (phase: AgentPhase, event: PhaseEvent): AgentPhase => {
  if (phase.kind === "closed") return phase;
  if (event.type === "closed") return CLOSED;
  if (phase.kind === "starting") {
    if (event.type === "recorded") return IDLE;
    if (event.type === "endRequested" || event.type === "exited") {
      return { kind: "ending", why: "remove", turnOpen: false, hidden: false };
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

const endingOrClosed = (phase: AgentPhase) => phase.kind === "ending" || phase.kind === "closed";

/** Whether a start or resume under way may record its process; one that exited before it was recorded may not. */
export const mayRecord = (phase: AgentPhase) => !endingOrClosed(phase);

export const endingByService = (phase: AgentPhase) => phase.kind === "ending" && phase.why !== "exited";

/** Recorded and not ended by the service: a process that exited still takes messages, settings and cancels until it closes. */
export const takesCalls = (phase: AgentPhase) =>
  phase.kind === "idle" || phase.kind === "turn" || phase.kind === "hidden" || (phase.kind === "ending" && phase.why === "exited");

export const isTurnOpen = (phase: AgentPhase) => phase.kind === "turn" || (phase.kind === "ending" && phase.turnOpen);

export const isHidden = (phase: AgentPhase) => phase.kind === "hidden" || (phase.kind === "ending" && phase.hidden);

export const isBeingRemoved = (phase: AgentPhase) => phase.kind === "ending" && phase.why === "remove";

/** Whether what the agent sends is stored now; until the agent is recorded, updates are held. */
export const recordsAgent = (phase: AgentPhase) => takesCalls(phase) || (phase.kind === "ending" && phase.why === "stop");

export const mayMintToken = (phase: AgentPhase) => !endingOrClosed(phase);

/** Whether the process closing in `phase` writes the end of its open turn. */
export const writesTurnEndOnClose = (phase: AgentPhase) => {
  const closing = next(phase, { type: "exited" });
  return closing.kind === "ending" && closing.turnOpen && closing.why !== "remove";
};

/** The agent's state the process closing in `phase` writes, if any. */
export const stateOnClose = (phase: AgentPhase): "stopped" | "error" | undefined => {
  const closing = next(phase, { type: "exited" });
  if (closing.kind !== "ending") return undefined;
  if (closing.why === "stop") return "stopped";
  return closing.why === "exited" ? "error" : undefined;
};
