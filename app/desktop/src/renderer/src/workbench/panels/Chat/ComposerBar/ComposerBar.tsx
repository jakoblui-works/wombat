import { useQueryClient } from "@tanstack/react-query";
import type { ListHarnessesResponse, Workspace } from "@wombat/shared/api";
import { ChevronRight, Monitor } from "lucide-react";

import { cn } from "../../../../lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { openFolderOrTell } from "../../../commands/open-folder.ts";
import type { Repo } from "./bar-picks.ts";

// Not a workspace id (those are `ws-` and ten letters or digits), so it never stands for one.
const OPEN_FOLDER = "open-folder";

const TRIGGER = "h-7 w-auto min-w-0 max-w-48 gap-1 border-transparent bg-transparent px-2 text-sm text-fg-secondary hover:bg-surface-2 hover:text-fg-primary";

type Props = {
  workspaces: readonly Workspace[];
  workspace: Workspace | undefined;
  onWorkspace: (id: string) => void;
  repos: readonly Repo[];
  repo: string | undefined;
  onRepo: (path: string) => void;
  harnesses: ListHarnessesResponse;
  harness: string | undefined;
  onHarness: (id: string) => void;
};

export const BAR_ROW = "flex min-w-0 items-center gap-1 pb-1.5";

export const Step = () => <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />;

export const Host = () => (
  <span className="flex shrink-0 items-center gap-1.5 px-2 text-sm text-fg-tertiary">
    <Monitor aria-hidden className="size-3.5" />
    <span>This Computer</span>
  </span>
);

/** Where a new agent starts and on what: the host, the workspace (or a folder opened as one), the repo, the harness. */
export const ComposerBar = ({ workspaces, workspace, onWorkspace, repos, repo, onRepo, harnesses, harness, onHarness }: Props) => {
  const queryClient = useQueryClient();
  return (
    <div className={BAR_ROW}>
      <Host />
      <Step />
      <Select
        value={workspace?.id ?? null}
        onValueChange={(value) => {
          if (value === OPEN_FOLDER) void openFolderOrTell(queryClient, onWorkspace);
          else if (value !== null) onWorkspace(value);
        }}
        items={workspaces.map(({ id, name }) => ({ value: id, label: name }))}
      >
        <SelectTrigger aria-label="Workspace" className={TRIGGER}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {workspaces.map(({ id, name, root }) => (
            <SelectItem key={id} value={id} title={root}>
              {name}
            </SelectItem>
          ))}
          {workspaces.length === 0 ? null : <div role="separator" className="my-1 h-px bg-line" />}
          <SelectItem value={OPEN_FOLDER}>Open folder…</SelectItem>
        </SelectContent>
      </Select>
      <Step />
      <Select
        value={repo ?? null}
        onValueChange={(value) => value !== null && onRepo(value)}
        items={repos.map(({ path, name }) => ({ value: path, label: name }))}
      >
        <SelectTrigger aria-label="Repo" disabled={repos.length === 0} className={TRIGGER}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {repos.map(({ path, name }) => (
            <SelectItem key={path} value={path}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={harness ?? null}
        onValueChange={(value) => value !== null && onHarness(value)}
        items={harnesses.map(({ id, name }) => ({ value: id, label: name }))}
      >
        <SelectTrigger aria-label="Harness" disabled={harnesses.length === 0} className={cn(TRIGGER, "ml-auto")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {harnesses.map(({ id, name }) => (
            <SelectItem key={id} value={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
