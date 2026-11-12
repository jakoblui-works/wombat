// Messages handed to an agent's message box from outside it: the New agent dialog's first message when the agent
// started but the message wasn't sent. The box opens on it in its failed-send state, so the user sends it from there.
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
