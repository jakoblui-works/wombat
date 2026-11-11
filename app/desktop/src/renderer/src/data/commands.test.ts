// A send's commandId comes from its variables, so a retry with the same variables is the same command.
import { afterEach, expect, test, vi } from "vitest";

import { sendMessageFn, sendMessageVars } from "./commands.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("sendMessageFn sends the commandId of its variables; a retry with them sends the same one, a new send another", async () => {
  const bodies: unknown[] = [];
  let status = 500;
  vi.stubGlobal("window", {
    wombat: {
      service: {
        request: (_method: string, _path: string, body: unknown) => {
          bodies.push(body);
          return Promise.resolve({ status, body: status === 202 ? { seq: 1 } : { error: { code: "internal_error", message: "Lost." } } });
        },
      },
    },
  });

  const vars = sendMessageVars("agent-bakery-1", "Fix the hours");
  await expect(sendMessageFn(vars)).rejects.toThrow("Lost.");
  status = 202;
  await sendMessageFn(vars);
  await sendMessageFn(sendMessageVars("agent-bakery-1", "Fix the hours"));

  const ids = bodies.map((body) => (body as { commandId: string }).commandId);
  expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[0]);
  expect(bodies[0]).toEqual({ text: "Fix the hours", commandId: ids[0] });
});
