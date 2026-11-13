import type { Activity } from "@wombat/shared/api";

/** What an agent is doing, in words: the one place the chat's working line and the agent row get them from. */
export const activityLabel = (activity: Activity): string => {
  switch (activity.kind) {
    case "thinking":
      return "Thinking…";
    case "writing":
      return "Writing…";
    case "tool":
      return activity.title === undefined || activity.title === "" ? "Running a tool" : `Running ${activity.title}`;
  }
};
