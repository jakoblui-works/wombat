// Whether an answer is an error, and the error's shape.
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";

import { call, ServiceError } from "./client.ts";

const answering = (status: number, body: unknown) => {
  vi.stubGlobal("window", { wombat: { service: { request: () => Promise.resolve({ status, body }) } } });
};
afterEach(() => {
  vi.unstubAllGlobals();
});

const Body = z.object({ n: z.int() });

test("a non-2xx answer throws a ServiceError from its ErrorBody, or code unknown for another shape", async () => {
  answering(409, { error: { code: "busy", message: "A turn is running.", hint: "Cancel it first." } });
  const busy = await call("POST", "/agents/a/messages", Body).catch((error: unknown) => error);
  expect(busy).toBeInstanceOf(ServiceError);
  expect(busy).toMatchObject({ status: 409, code: "busy", message: "A turn is running.", hint: "Cancel it first." });

  answering(502, "<html>Bad gateway</html>");
  const unknown = await call("GET", "/agents", Body).catch((error: unknown) => error);
  expect(unknown).toBeInstanceOf(ServiceError);
  expect(unknown).toMatchObject({ status: 502, code: "unknown" });
  expect((unknown as ServiceError).hint).toBeUndefined();
});
