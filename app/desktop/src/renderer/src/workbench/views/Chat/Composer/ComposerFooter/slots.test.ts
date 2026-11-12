// S2c, T14 (row T14-1): which component fills a footer slot. A harness's override fills only the slot it registered,
// and only for that harness; every other slot and harness gets the default. Harness ids are invented and used by
// this file alone (the registry is the page's one global).
import type { ComponentType } from "react";
import { expect, test } from "vitest";

import { type ContextDialogProps, footerSlot, registerHarnessUi } from "./slots.ts";

const OwnDialog: ComponentType<ContextDialogProps> = () => null;

test("an override fills its own slot for its own harness; everything else is the default", () => {
  const defaults = {
    settings: footerSlot("t14-plain-harness", "settings"),
    context: footerSlot("t14-plain-harness", "context"),
    contextDialog: footerSlot("t14-plain-harness", "contextDialog"),
  };
  expect(new Set(Object.values(defaults)).size, "a default per slot").toBe(3);

  registerHarnessUi("t14-own-dialog", { contextDialog: OwnDialog });

  expect(footerSlot("t14-own-dialog", "contextDialog")).toBe(OwnDialog);
  expect(footerSlot("t14-own-dialog", "settings")).toBe(defaults.settings);
  expect(footerSlot("t14-own-dialog", "context")).toBe(defaults.context);
  expect(footerSlot("t14-plain-harness", "contextDialog")).toBe(defaults.contextDialog);
});
