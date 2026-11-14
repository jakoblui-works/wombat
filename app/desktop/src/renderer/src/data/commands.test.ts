// A send's commandId comes from its variables, so a retry with the same variables is the same command.
import { afterEach, expect, test, vi } from "vitest";

import { approveOutcome, sendMessageFn, sendMessageVars } from "./commands.ts";

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

// "Ask for changes" sends the proposal it refers to with the message; the service tells the agent which one it is.
test("a send with a proposal reference carries its proposalId; one without carries none", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal("window", {
    wombat: {
      service: {
        request: (_method: string, _path: string, body: unknown) => {
          bodies.push(body);
          return Promise.resolve({ status: 202, body: { seq: 1 } });
        },
      },
    },
  });

  await sendMessageFn(sendMessageVars("agent-bakery-1", "Keep Saturday at 8:00.", "prp_hours"));
  await sendMessageFn(sendMessageVars("agent-bakery-1", "Thanks."));

  expect(bodies[0]).toMatchObject({ text: "Keep Saturday at 8:00.", proposalId: "prp_hours" });
  expect(bodies[1]).not.toHaveProperty("proposalId");
});

// An approve that met a file changed since leaves the proposal open at a new version, re-applied for the user to
// look at: "changed" opens it, so the next click never approves a version nobody saw.
test("an approve came to a new version only when the proposal is still open at a higher one than sent", () => {
  expect(approveOutcome(2, { status: "pending", version: 3 }), "re-applied as a new version").toBe("changed");
  expect(approveOutcome(2, { status: "approved", version: 2 }), "written").toBe("decided");
  expect(approveOutcome(2, { status: "conflict", version: 2 }), "a conflict, shown where it is").toBe("decided");
  expect(approveOutcome(2, { status: "pending", version: 2 }), "a problem to approve again, same version").toBe("decided");
});
