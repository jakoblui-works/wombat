// The words of quitting: the quit question's box, how its buttons map to answers, and the notice that a service kept
// running at quit raises. Kept apart from index.ts so the mapping can be checked without Electron.
import type { MessageBoxOptions } from "electron";
import type { Notice } from "./notice-sink.ts";
import type { QuitChoice } from "./quit.ts";

/** "1 agent", "3 agents". */
const agentCount = (running: number): string => `${String(running)} ${running === 1 ? "agent" : "agents"}`;

/** The question's buttons in order, each with its answer. */
const BUTTONS = [
  ["Keep running", "leave"],
  ["Stop agents and quit", "stop"],
  ["Cancel", "cancel"],
] as const satisfies readonly (readonly [string, QuitChoice["answer"]])[];

const CANCEL = BUTTONS.findIndex(([, answer]) => answer === "cancel");

/** The quit question's box; `running` is undefined when the agents couldn't be read. */
export const quitQuestion = (running: number | undefined): MessageBoxOptions => ({
  type: "question",
  buttons: BUTTONS.map(([label]) => label),
  defaultId: 0,
  cancelId: CANCEL,
  message:
    running === undefined ? "Agents may still be running." : `${agentCount(running)} ${running === 1 ? "is" : "are"} still running.`,
  detail:
    "Keep running leaves them working in the agent service, which keeps running in the background until you stop it; " +
    "Wombat shows them again when it opens. Stop agents and quit ends their work mid-task.",
  checkboxLabel: "Don't ask again",
});

/** The answer for the box's `response` (the button's index) and its checkbox; anything unknown is Cancel. */
export const quitChoice = (response: number, checkboxChecked: boolean): QuitChoice => ({
  answer: BUTTONS[response]?.[1] ?? "cancel",
  dontAsk: checkboxChecked,
});

/** The notice that the service keeps running after the app quit; `running` is undefined when it isn't known. */
export const keptNotice = (running: number | undefined): Notice => ({
  title: "Wombat",
  body: `The agent service is still running${running === undefined ? "" : ` with ${agentCount(running)}`}. Open Wombat to stop it.`,
});
