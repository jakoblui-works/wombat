import { cn } from "@/lib/utils";
import { activities } from "../../registry.ts";
import { activeToolbarButton, pressToolbarButton } from "../shell-state.ts";
import { useShell } from "../ShellProvider.tsx";

/** One button per activity, choosing what the shown workspace's right sidebar shows; with no workspace shown there are none. */
export const Toolbar = ({ workspace }: { workspace: string | undefined }) => {
  const { state, change } = useShell();
  const active = workspace === undefined ? undefined : activeToolbarButton(state, workspace);
  return (
    <div className="flex w-activity-bar shrink-0 flex-col items-center gap-1 border-l border-line bg-surface-0 py-2">
      {workspace === undefined
        ? null
        : activities().map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={id === active}
              onClick={() => change((current) => pressToolbarButton(current, workspace, id))}
              className={cn(
                "focus-ring relative flex size-9 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-surface-2 hover:text-fg-secondary",
                id === active && "bg-surface-2 text-fg-primary hover:text-fg-primary",
              )}
            >
              {id === active ? <span className="absolute inset-y-2 right-0.5 w-0.5 rounded-full bg-fg-primary" /> : null}
              <Icon className="size-4.5" strokeWidth={1.75} />
            </button>
          ))}
    </div>
  );
};
