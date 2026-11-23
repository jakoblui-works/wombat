// Each agent's message box, kept outside it: its text, a send's error and the reference survive the chat not showing,
// and a send under way settles here even when no box shows. Also what is handed to the box from outside it: the empty
// chat's first message when the started agent didn't take it, and the proposal Ask for changes puts above it.
import { useSyncExternalStore } from "react";

import {
  type ComposerEntry,
  type ComposerEntryEvent,
  composerEntryReducer,
  type ComposerState,
  composerReducer,
  EMPTY_ENTRY,
  isEmptyEntry,
} from "./composer-state.ts";

/** The key the empty chat's message box is kept under, beside the agents' ids (which never take it). */
export const NEW_CHAT_BOX = "new-chat";

/** The empty chat's composer bar picks: the repo picked in each workspace, by workspace id, and the harness picked. */
export type NewChatPicks = { repos: Readonly<Record<string, string>>; harness?: string };

const entries = new Map<string, ComposerEntry>();
let newChatPicks: NewChatPicks = { repos: {} };
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of [...listeners]) listener();
};

const entryOf = (agentId: string): ComposerEntry => entries.get(agentId) ?? EMPTY_ENTRY;

const put = (agentId: string, entry: ComposerEntry): void => {
  if (isEmptyEntry(entry)) entries.delete(agentId);
  else entries.set(agentId, entry);
  notify();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const composerEvent = (agentId: string, event: ComposerEntryEvent): void => put(agentId, composerEntryReducer(entryOf(agentId), event));

export const useNewChatPicks = (): NewChatPicks => useSyncExternalStore(subscribe, () => newChatPicks);

export const pickNewChatRepo = (workspace: string, path: string): void => {
  newChatPicks = { ...newChatPicks, repos: { ...newChatPicks.repos, [workspace]: path } };
  notify();
};

export const pickNewChatHarness = (harness: string): void => {
  newChatPicks = { ...newChatPicks, harness };
  notify();
};

/** The agent's message box and reference, as kept; re-renders on every change to them. */
export const useComposerEntry = (agentId: string): ComposerEntry => useSyncExternalStore(subscribe, () => entryOf(agentId));

/** Leaves `text` in the agent's message box as a failed send, with why it failed. */
export const handOverUnsent = (agentId: string, text: string, error: Error): void => {
  const entry = entryOf(agentId);
  put(agentId, { ...entry, composer: composerReducer({ text }, { type: "failed", message: error.message }) });
};

export const openingComposer = (agentId: string): ComposerState => entryOf(agentId).composer;

/** Drops everything kept for the agent's message box. */
export const forgetUnsent = (agentId: string): void => put(agentId, EMPTY_ENTRY);

/** Puts a proposal above the agent's message box as its reference, to be sent along with the next message. */
export const setReference = (agentId: string, proposalId: string): void => composerEvent(agentId, { type: "refer", proposalId });
