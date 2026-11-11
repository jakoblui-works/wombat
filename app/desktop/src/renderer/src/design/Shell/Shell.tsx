import type { ReactNode } from "react";

import { REQUESTS } from "../fixtures.ts";
import { ActivityBar, type Connection, type DesignActivity } from "./ActivityBar.tsx";
import { TitleBar } from "./TitleBar.tsx";

export type ShellProps = {
  activity: DesignActivity;
  sidebar: ReactNode;
  editor: ReactNode;
  /** The right sidebar's content (Needs me) when it's open; collapsed otherwise. */
  needsMe?: ReactNode;
  connection?: Connection;
  /** A blocking state, attached under the title bar; the views below are dimmed and inert, the title bar stays live. */
  blocker?: ReactNode;
};

/** The workbench: title area, activity bar, left sidebar, editor area and the right sidebar. */
export const Shell = ({ activity, sidebar, editor, needsMe, connection = "connected", blocker }: ShellProps) => {
  const blocked = blocker !== undefined;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-0 text-fg-primary">
      <TitleBar needsMe={REQUESTS.length} needsMeOpen={needsMe !== undefined} />
      {blocker}
      <div className="flex min-h-0 flex-1">
        <ActivityBar active={activity} connection={connection} blocked={blocked} />
        <div className="relative flex min-w-0 flex-1">
          <aside inert={blocked} className="flex w-sidebar shrink-0 flex-col border-r border-line bg-surface-0">
            {sidebar}
          </aside>
          <main inert={blocked} className="flex min-w-0 flex-1">
            {editor}
          </main>
          {needsMe === undefined ? null : (
            <aside inert={blocked} className="flex w-needs-me shrink-0 flex-col border-l border-line bg-surface-0">
              {needsMe}
            </aside>
          )}
          {blocked ? <div className="pointer-events-none absolute inset-0 bg-scrim" /> : null}
        </div>
      </div>
    </div>
  );
};
