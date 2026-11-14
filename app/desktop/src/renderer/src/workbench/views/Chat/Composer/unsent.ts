// What is handed to an agent's message box from outside it. A message: the New agent dialog's first one when the agent
// started but the message wasn't sent; the box opens on it in its failed-send state, so the user sends it from there.
import { type ComposerState, composerReducer, EMPTY_COMPOSER } from "./composer-state.ts";

const unsent = new Map<string, ComposerState>();

/** Leaves `text` in the agent's message box, with why sending it failed, for when the box opens. */
export const handOverUnsent = (agentId: string, text: string, error: Error): void => {
  unsent.set(agentId, composerReducer({ text }, { type: "failed", message: error.message }));
};

/** What the agent's message box opens on: a handed-over message, else empty. */
export const openingComposer = (agentId: string): ComposerState => unsent.get(agentId) ?? EMPTY_COMPOSER;

/** Drops a handed-over message once the box holds it, so a box opened later starts empty. */
export const forgetUnsent = (agentId: string): void => {
  unsent.delete(agentId);
};

// A proposal Ask for changes puts above the box, to be sent along with the next message.
const references = new Map<string, string>();
const listeners = new Set<() => void>();

/** Puts a proposal above the agent's message box as its reference; the open box picks it up at once. */
export const setReference = (agentId: string, proposalId: string): void => {
  references.set(agentId, proposalId);
  for (const listener of [...listeners]) listener();
};

/** The proposal waiting as the agent's reference, handed over once: a box that holds it keeps it. */
export const takeReference = (agentId: string): string | undefined => {
  const proposalId = references.get(agentId);
  references.delete(agentId);
  return proposalId;
};

/** Calls `listener` whenever a reference is set; returns how to stop. */
export const onReference = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
