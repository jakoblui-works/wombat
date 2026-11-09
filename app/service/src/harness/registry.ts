import { claudeCode } from "./claude-code.ts";
import type { Harness } from "./harness.ts";

/** The harnesses the service offers. */
export const defaultHarnesses: readonly Harness[] = [claudeCode];

export const findHarness = (id: string, harnesses: readonly Harness[] = defaultHarnesses): Harness | undefined =>
  harnesses.find((harness) => harness.id === id);
