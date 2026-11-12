// GET /version's answer (contract "Service identity"): startedAt and codeId are optional, because a service from before
// they were added answers without them, and the app must still recognise it (as stale) rather than lose it.
import { expect, test } from "vitest";

import { VersionResponse } from "./api.ts";

test("an answer from before startedAt and codeId still parses, and a full one keeps both", () => {
  expect(VersionResponse.parse({ apiVersion: 1 })).toEqual({ apiVersion: 1 });
  const full = { apiVersion: 1, startedAt: "2026-11-12T07:34:00.000Z", codeId: "0123456789abcdef" };
  expect(VersionResponse.parse(full)).toEqual(full);
});
