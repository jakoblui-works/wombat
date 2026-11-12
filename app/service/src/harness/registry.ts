import { claudeCode } from "./claude-code.ts";
import type { Harness } from "./harness.ts";

/** The harnesses the service offers. */
export const defaultHarnesses: readonly Harness[] = [claudeCode];

export const findHarness = (id: string, harnesses: readonly Harness[] = defaultHarnesses): Harness | undefined =>
  harnesses.find((harness) => harness.id === id);

/**
 * What the harness offers beyond the core, as `GET /harnesses` lists it: `context` when it has `contextBreakdown`.
 * The one place features are derived; the app reads only this.
 */
export const harnessFeatures = (harness: Harness): string[] => (harness.contextBreakdown === undefined ? [] : ["context"]);
