import { expect, test } from "vitest";

import { ServiceError } from "../../../../data/client.ts";
import { contextErrorMessage } from "./ContextDialogHost.tsx";

test("a busy agent says the breakdown is available once it is idle; other errors say their own message", () => {
  expect(contextErrorMessage(new ServiceError(409, { code: "busy", message: "A turn is running." }))).toBe("Available once the agent is idle");
  expect(contextErrorMessage(new ServiceError(500, { code: "agent_error", message: "The agent failed." }))).toBe("The agent failed.");
  expect(contextErrorMessage(new Error("offline"))).toBe("offline");
});
