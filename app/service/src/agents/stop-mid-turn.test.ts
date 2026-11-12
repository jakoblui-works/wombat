// An agent that answers its running turn with an error while the service stops it: the turn ends "stopped" and the
// agent is stopped, as when the process ends first; the error answer is part of the stopping, not a failed turn.
import { SERVICE_STOP_REASON } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { REPO, setup, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";

test(
  "a turn the agent fails while being stopped ends stopped, not error",
  async () => {
    const t = setup();
    const { id } = await t.manager.start("fake-stop-error", REPO);
    await t.manager.send(id, { text: "Work on it" });
    await waitFor("the agent's message", () =>
      t.entries(id).some((entry) => entry.type === "session_update" && entry.update.sessionUpdate === "agent_message_chunk"),
    );

    await t.manager.stop(id);

    expect(t.agent(id)?.state).toBe("stopped");
    expect(t.entries(id).filter((entry) => entry.type === "turn_ended").map((entry) => entry.stopReason)).toEqual([
      SERVICE_STOP_REASON.stopped,
    ]);
  },
  TEST_TIMEOUT_MS,
);
