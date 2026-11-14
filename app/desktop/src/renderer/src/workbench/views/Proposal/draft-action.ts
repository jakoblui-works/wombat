import { sameAsAgents } from "@wombat/shared/proposals";

/**
 * What a change to the right side does to my draft: "save" my text, "clear" my saved draft (my text is the agent's
 * again) or "none". `savedText` is my saved draft's text, undefined while I have none. Texts compare exactly, line
 * endings and the final newline included.
 */
export const draftAction = (agentText: string, myText: string, savedText: string | undefined): "save" | "clear" | "none" => {
  if (sameAsAgents({ text: myText }, { text: agentText })) return savedText === undefined ? "none" : "clear";
  return myText === savedText ? "none" : "save";
};
