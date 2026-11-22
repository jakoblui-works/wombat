import { sameAsAgents } from "@wombat/shared/proposals";

/** A version's content as a draft compares it: a file's whole text, or an item's fields. */
export type DraftComparable = Parameters<typeof sameAsAgents>[0];

/**
 * What a change of my content does to my draft: "save" it, "clear" my saved draft (my content is the agent's again)
 * or "none". `saved` is my saved draft's content, undefined while I have none. Contents compare as the service does.
 */
export const contentAction = (agent: DraftComparable, mine: DraftComparable, saved: DraftComparable | undefined): "save" | "clear" | "none" => {
  if (sameAsAgents(mine, agent)) return saved === undefined ? "none" : "clear";
  return saved !== undefined && sameAsAgents(mine, saved) ? "none" : "save";
};

/**
 * What a change to the right side does to my draft: "save" my text, "clear" my saved draft (my text is the agent's
 * again) or "none". `savedText` is my saved draft's text, undefined while I have none. Texts compare exactly, line
 * endings and the final newline included.
 */
export const draftAction = (agentText: string, myText: string, savedText: string | undefined): "save" | "clear" | "none" =>
  contentAction({ text: agentText }, { text: myText }, savedText === undefined ? undefined : { text: savedText });
