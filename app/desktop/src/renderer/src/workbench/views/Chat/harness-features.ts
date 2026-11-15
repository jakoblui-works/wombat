import { HARNESS_FEATURE } from "@wombat/shared/api";

import { useHarnesses } from "../../../data/hooks.ts";

const CLAUDE_LIKE = [HARNESS_FEATURE.resume, HARNESS_FEATURE.context];

/**
 * The features to go by: the harness's, or, while `GET /harnesses` hasn't answered or has failed (`undefined`),
 * resume and the context breakdown, so a stopped agent's chat isn't shown closed for that time.
 */
export const featuresOrAssumed = (features: readonly string[] | undefined): readonly string[] => features ?? CLAUDE_LIKE;

/** A harness's features (`GET /harnesses`); undefined until the list is known (`featuresOrAssumed` then). */
export const useHarnessFeatures = (harnessId: string | undefined): readonly string[] | undefined => {
  const harnesses = useHarnesses();
  return harnesses.data === undefined ? undefined : (harnesses.data.find(({ id }) => id === harnessId)?.features ?? []);
};
