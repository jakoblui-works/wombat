import { expect, test } from "vitest";

import { showsLaunchNotice } from "./launch-notice.ts";

const LAUNCH = Date.parse("2026-03-10T12:00:00.000Z");

test("a service that started before the app launched is announced", () => {
  expect(showsLaunchNotice({ startedAt: "2026-03-10T06:00:00.000Z", launchedAt: LAUNCH, shown: false })).toBe(true);
});

test("a service the app started after its launch is not announced", () => {
  expect(showsLaunchNotice({ startedAt: "2026-03-10T12:00:03.000Z", launchedAt: LAUNCH, shown: false })).toBe(false);
});

test("a service of unknown start is not announced", () => {
  expect(showsLaunchNotice({ startedAt: undefined, launchedAt: LAUNCH, shown: false })).toBe(false);
});

test("it shows once per launch", () => {
  expect(showsLaunchNotice({ startedAt: "2026-03-10T06:00:00.000Z", launchedAt: LAUNCH, shown: true })).toBe(false);
});
