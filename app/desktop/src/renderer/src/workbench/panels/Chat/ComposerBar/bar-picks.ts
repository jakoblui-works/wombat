// What the composer bar starts an agent with, pure: which repos it offers and which value each picker holds.
import type { ListReposResponse, Workspace } from "@wombat/shared/api";

import { repoName } from "./running-bar.ts";

export type Repo = ListReposResponse["repos"][number];

/**
 * The repos offered in `workspace`: the service's list, else (unread, or its read failed, as for a workspace whose
 * folder is gone) the workspace root alone, so a start there still reaches the service and gets its answer.
 */
export const repoChoices = (listed: readonly Repo[] | undefined, workspace: Pick<Workspace, "name"> | undefined): readonly Repo[] =>
  workspace === undefined ? [] : (listed ?? [{ path: ".", name: repoName(".", workspace) }]);

/** The first of `wanted` that is offered, else the first offered; undefined while nothing is. */
export const pickOf = (offered: readonly string[], ...wanted: readonly (string | undefined)[]): string | undefined =>
  wanted.find((value) => value !== undefined && offered.includes(value)) ?? offered[0];
