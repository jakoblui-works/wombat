// The diff tab's params and when it applies, pure (the registry, the restore and the live prune read them).
import { z } from "zod";

import type { KnownContext } from "../../registry.ts";
import { fileName } from "./edit-request.ts";

export const DiffParams = z.object({ agentId: z.string(), requestId: z.string() });
export type DiffParams = z.infer<typeof DiffParams>;

/** The tab's title until its view has read the request's file (the view reports "<file name> (diff)"). */
export const DIFF_TITLE = "Diff";

/** The title the diff tab shows for an edit of `path`. */
export const diffTitle = (path: string): string => `${fileName(path)} (diff)`;

/** While the app runs, a diff tab applies while its agent exists: an answered request's tab shows its outcome. */
export const diffResolves = (params: unknown, { agents }: KnownContext): boolean => {
  const parsed = DiffParams.safeParse(params);
  return parsed.success && agents.some(({ id }) => id === parsed.data.agentId);
};

/** At the next start, a diff tab comes back only while its request is still pending. */
export const diffRestores = (params: unknown, { agents }: KnownContext): boolean => {
  const parsed = DiffParams.safeParse(params);
  if (!parsed.success) return false;
  const { agentId, requestId } = parsed.data;
  return agents.some(({ id, pendingPermissions }) => id === agentId && pendingPermissions.some((pending) => pending.requestId === requestId));
};
