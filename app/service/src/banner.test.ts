import { API_VERSION } from "@wombat/shared";
import { expect, test } from "vitest";

import { banner } from "./banner.ts";

test("banner names the service and the shared API version", () => {
  expect(banner()).toMatch(/^wombat service, api \d+$/);
  expect(banner()).toContain(String(API_VERSION));
});
