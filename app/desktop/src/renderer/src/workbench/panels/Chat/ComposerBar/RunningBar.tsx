import type { AgentSummary } from "@wombat/shared/api";
import { ChevronDown, ChevronUp, GitBranch } from "lucide-react";

import { useHarnesses, useWorkspaces } from "../../../../data/hooks.ts";
import { cn } from "../../../../lib/utils";
import { useShell } from "../../../shell/ShellProvider.tsx";
import { collapseBar } from "../../../shell/shell-state.ts";
import { BAR_ROW, Host, Step } from "./ComposerBar.tsx";
import { runningBarValues, type RunningBarValues } from "./running-bar.ts";

const VALUE = "min-w-0 truncate px-2 text-sm text-fg-secondary";

const Chevron = ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => {
  const label = collapsed ? "Show composer bar" : "Hide composer bar";
  const Icon = collapsed ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="focus-ring flex size-6 shrink-0 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-surface-2 hover:text-fg-primary"
    >
      <Icon className="size-3.5" />
    </button>
  );
};

const Values = ({ values }: { values: RunningBarValues }) => (
  <>
    <Host />
    {values.workspace === undefined ? null : (
      <>
        <Step />
        <span className={VALUE}>{values.workspace}</span>
      </>
    )}
    {values.repo === undefined ? null : (
      <>
        <Step />
        <span className={VALUE}>{values.repo}</span>
      </>
    )}
    {values.branch === undefined ? null : (
      <span className="flex min-w-0 items-center gap-1 px-1 font-mono text-xs text-fg-tertiary">
        <GitBranch aria-label="branch" className="size-3 shrink-0" />
        <span className="truncate">{values.branch}</span>
      </span>
    )}
    <span className={cn(VALUE, "ml-auto")}>{values.harness}</span>
  </>
);

/** A running agent's composer bar: where it runs and on what, read-only; collapsed or not for every chat. */
export const RunningBar = ({ agent }: { agent: AgentSummary }) => {
  const { state, change } = useShell();
  const workspaces = useWorkspaces();
  const harnesses = useHarnesses();
  const collapsed = state.barCollapsed;
  // One row in both states with the chevron in the same slot, so toggling keeps the same button and its focus.
  return (
    <div className={cn(BAR_ROW, "justify-end")}>
      {collapsed ? null : <Values values={runningBarValues(agent, workspaces.data?.workspaces, harnesses.data)} />}
      <Chevron collapsed={collapsed} onToggle={() => change((current) => collapseBar(current, !current.barCollapsed))} />
    </div>
  );
};
