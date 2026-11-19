import { type ItemSummary, SETTINGS_FILE } from "@wombat/shared/items";
import type { ReactNode } from "react";

import { lastPathPart } from "../../../../lib/path.ts";
import { ProblemList } from "../../Desk/ProblemList/ProblemList.tsx";
import { type BrokenBinder, type ItemShown, settingsPath } from "../item-state.ts";

const READ_FAILED = { item: "Couldn't read the item", binders: "Couldn't read the binders", "binder-items": "Couldn't read the binder's items" } as const;

const Notice = ({ children }: { children: ReactNode }) => (
  <div role="status" className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-secondary">
    {children}
  </div>
);

const Path = ({ path }: { path: string }) => <span className="font-mono text-xs break-all text-fg-primary">{path}</span>;

const Unreadable = ({ entries }: { entries: readonly ItemSummary[] }) => (
  <ul className="flex flex-col gap-2">
    {entries.map((entry) => (
      <li key={entry.path} className="flex flex-col gap-1">
        <Path path={entry.path} />
        <ProblemList problems={entry.problems} file={lastPathPart(entry.path)} className="text-sm text-danger" />
      </li>
    ))}
  </ul>
);

const BrokenBinders = ({ binders }: { binders: readonly BrokenBinder[] }) => (
  <ul className="flex flex-col gap-2">
    {binders.map((binder) => (
      <li key={binder.path} className="flex flex-col gap-1">
        <Path path={settingsPath(binder)} />
        <ProblemList problems={binder.problems} file={SETTINGS_FILE} className="text-sm text-danger" />
      </li>
    ))}
  </ul>
);

/** What the tab says about the item when it can't show it as read; nothing while it can. */
export const ItemNotice = ({ shown }: { shown: Exclude<ItemShown, { kind: "loading" }> }) => {
  switch (shown.kind) {
    case "item":
      return null;
    case "unparseable":
      return (
        <Notice>
          <p>This item's file can't be read, so its fields and body can't be shown:</p>
          <ProblemList problems={shown.entry.problems} file={lastPathPart(shown.entry.path)} className="text-sm text-danger" />
          <p>
            Fix <Path path={shown.entry.path} /> by hand; the item shows here again once it can be read.
          </p>
        </Notice>
      );
    case "missing":
      return (
        <Notice>
          <p>This item can't be found: its file was deleted or can't be read.</p>
          {shown.unreadable.length === 0 ? null : (
            <>
              <p>These files in {shown.binder.name} can't be read; if one of them is this item, fix it by hand:</p>
              <Unreadable entries={shown.unreadable} />
            </>
          )}
        </Notice>
      );
    case "gone":
      return (
        <Notice>
          <p>This item no longer exists: its file is no longer in {shown.binder.name}. Close this tab.</p>
        </Notice>
      );
    case "binder-broken":
      return (
        <Notice>
          <p>This item's binder can't be read, so the item can't be shown: its {SETTINGS_FILE} has problems.</p>
          <ProblemList problems={shown.binder.problems} file={SETTINGS_FILE} className="text-sm text-danger" />
          <p>
            Fix <Path path={settingsPath(shown.binder)} /> by hand; the item shows here again once it can be read.
          </p>
        </Notice>
      );
    case "binder-missing":
      return (
        <Notice>
          <p>This item's binder can't be found: its folder was deleted or its {SETTINGS_FILE} can't be read. These binders can't be read; if one of them is this item's, fix it by hand:</p>
          <BrokenBinders binders={shown.broken} />
        </Notice>
      );
    case "binder-gone":
      return (
        <Notice>
          <p>This item's binder no longer exists, so the item can't be shown. Close this tab.</p>
        </Notice>
      );
    case "error":
      return (
        <p role="alert" className="text-sm text-danger">
          {READ_FAILED[shown.what]}: {shown.message}
        </p>
      );
  }
};
