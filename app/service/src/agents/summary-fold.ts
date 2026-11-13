import type { AgentSummary } from "@wombat/shared/api";
import { activityOf, emptyFold, foldEntry, lastMainMessage, type FoldState } from "@wombat/shared/log-fold";

import { excerpt, keepForExcerpt } from "./excerpt.ts";

type StoredEntry = Parameters<typeof foldEntry>[1];

/**
 * The turn's fold with the stored entries folded in. A user message starts a new turn's fold: the fold holds one turn,
 * and of each text only what an excerpt needs.
 */
export const foldTurn = (fold: FoldState, sessionId: string | undefined, entries: readonly StoredEntry[]): FoldState => {
  let current = fold;
  for (const entry of entries) {
    if (entry.type === "user_message") current = emptyFold(sessionId);
    foldEntry(current, entry, { keepText: keepForExcerpt });
  }
  return current;
};

/**
 * `current` with what the turn's fold says now: the activity while the agent works (else none), and lastText. With no
 * main-session message in the fold (a new turn), the stored lastText stays.
 */
export const summaryFromFold = (fold: FoldState | undefined, current: AgentSummary, state: AgentSummary["state"]): AgentSummary => {
  const next: AgentSummary = { ...current, activity: state === "working" && fold ? activityOf(fold) : null };
  const message = fold && lastMainMessage(fold);
  if (message !== undefined) {
    const text = excerpt(message);
    delete next.lastText;
    if (text !== "") next.lastText = text;
  }
  return next;
};
