import { HARNESS_FEATURE } from "@wombat/shared/api";

const CLAUDE_LIKE = [HARNESS_FEATURE.resume, HARNESS_FEATURE.context];

/**
 * The features to go by: the harness's, or, while `GET /harnesses` hasn't answered or has failed (`undefined`),
 * resume and the context breakdown, so a stopped agent's chat isn't shown closed for that time.
 */
export const featuresOrAssumed = (features: readonly string[] | undefined): readonly string[] => features ?? CLAUDE_LIKE;
