import type { ReactNode } from "react";

import { AGENTS_ACTIVITY } from "../../workbench/activities.ts";
import { DEFAULT_SIDEBARS } from "../../workbench/layout.ts";
import { activities } from "../../workbench/registry.ts";
import { REQUESTS } from "../fixtures.ts";
import { ActivityBar, type Connection } from "./ActivityBar.tsx";
import { TitleBar } from "./TitleBar.tsx";

export type ShellProps = {
  /** The selected activity's id, as registered (workbench/activities.ts). */
  activity?: string;
  sidebar: ReactNode;
  editor: ReactNode;
  /** The right sidebar's content (Needs me) when it's open; collapsed otherwise. */
  needsMe?: ReactNode;
  connection?: Connection;
  /** A blocking state, attached under the title bar; the views below are dimmed and inert, the title bar stays live. */
  blocker?: ReactNode;
};

/** The workbench: title area, activity bar, left sidebar, editor area and the right sidebar. */
export const Shell = ({ activity = AGENTS_ACTIVITY, sidebar, editor, needsMe, connection = "connected", blocker }: ShellProps) => {
  const blocked = blocker !== undefined;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-0 text-fg-primary">
      <TitleBar needsMe={REQUESTS.length} needsMeOpen={needsMe !== undefined} />
      {blocker}
      <div className="flex min-h-0 flex-1">
        <ActivityBar activities={activities()} active={activity} connection={connection} blocked={blocked} />
        <div className="relative flex min-w-0 flex-1">
          <aside inert={blocked} className="flex shrink-0 flex-col border-r border-line bg-surface-0" style={{ width: DEFAULT_SIDEBARS.left }}>
            {sidebar}
          </aside>
          <main inert={blocked} className="flex min-w-0 flex-1">
            {editor}
          </main>
          {needsMe === undefined ? null : (
            <aside inert={blocked} className="flex shrink-0 flex-col border-l border-line bg-surface-0" style={{ width: DEFAULT_SIDEBARS.right }}>
              {needsMe}
            </aside>
          )}
          {blocked ? <div className="pointer-events-none absolute inset-0 bg-scrim" /> : null}
        </div>
      </div>
    </div>
  );
};
