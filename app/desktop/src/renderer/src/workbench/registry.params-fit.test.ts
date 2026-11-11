// The one check of a tab's params against its view's schema, used by isKnown (the restore, the live prune) and openTab.
import { Circle } from "lucide-react";
import { expect, test } from "vitest";
import { z } from "zod";

import { paramsFit, type ViewDescriptor } from "./registry.ts";

const view = (paramsSchema?: ViewDescriptor["paramsSchema"]): ViewDescriptor => ({
  id: "test-view",
  title: "Test",
  icon: Circle,
  locations: ["editor"],
  component: () => null,
  ...(paramsSchema === undefined ? {} : { paramsSchema }),
});

test("params fit a view's paramsSchema when they parse, and any params fit a view without one", () => {
  const withSchema = view(z.object({ path: z.string() }));
  expect(paramsFit(withSchema, { path: "hours.md" })).toBe(true);
  expect(paramsFit(withSchema, { path: 7 })).toBe(false);
  expect(paramsFit(view(), { anything: [1, 2] })).toBe(true);
});
