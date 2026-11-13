// The message box's rules, pure: when Send works, what a key does, and what a send's outcome does to the text.

export type ComposerState = {
  text: string;
  /** The text of the send under way (cleared from the box only if it's still what the box holds when it succeeds). */
  sending?: string | undefined;
  /** Why the last send failed; the text it tried to send stays in the box. */
  error?: string | undefined;
};

export type ComposerEvent =
  | { type: "edit"; text: string }
  | { type: "send" }
  | { type: "sent" }
  | { type: "failed"; message: string };

export const EMPTY_COMPOSER: ComposerState = { text: "" };

export const composerReducer = (state: ComposerState, event: ComposerEvent): ComposerState => {
  switch (event.type) {
    case "edit":
      return { ...state, text: event.text };
    case "send":
      return { text: state.text, sending: state.text };
    case "sent":
      return { text: state.text === state.sending ? "" : state.text };
    case "failed":
      return { text: state.text, error: event.message };
  }
};

/**
 * Whether Send works: there's text, no send or turn is under way (the service answers `busy`), the app is connected,
 * and the agent has a process (a stopped agent's send would fail with `not_running`).
 */
export const canSend = (
  state: ComposerState,
  { turnActive, connected, stopped = false }: { turnActive: boolean; connected: boolean; stopped?: boolean },
): boolean => state.text.trim() !== "" && state.sending === undefined && !turnActive && connected && !stopped;

/** What a key in the message box does: Enter sends; Shift+Enter (and Enter while an IME composes) is a new line. */
export const keyAction = ({ key, shiftKey, isComposing }: { key: string; shiftKey: boolean; isComposing: boolean }): "send" | "type" =>
  key === "Enter" && !shiftKey && !isComposing ? "send" : "type";

/** Whether the text is an app command rather than a message: the whole text `/context`, for a harness that offers it. */
export const appCommand = (text: string, features: readonly string[]): "context" | undefined =>
  text.trim() === "/context" && features.includes("context") ? "context" : undefined;
