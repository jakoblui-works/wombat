import { type ItemSummary, SETTINGS_FILE } from "@wombat/shared/items";
import type { ReactNode } from "react";

import { lastPathPart } from "../../../lib/path.ts";
import { type BrokenBinder, type NoBinder, settingsPath } from "../binders.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";

/** What a failed read of a tab's content says before the error's message. */
export const READ_FAILED = { item: "Couldn't read the item", binders: "Couldn't read the binders", "binder-items": "Couldn't read the binder's items" } as const;

export const Notice = ({ children }: { children: ReactNode }) => (
  <div role="status" className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-secondary">
    {children}
  </div>
);

export const Path = ({ path }: { path: string }) => <span className="font-mono text-xs break-all text-fg-primary">{path}</span>;

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

/** What an item's views say about an item whose file can't be parsed: why, its problems, and which file to fix. */
export const UnparseableItem = ({ entry }: { entry: ItemSummary }) => (
  <>
    <p>This item's file can't be read, so its fields and body can't be shown:</p>
    <ProblemList problems={entry.problems} file={lastPathPart(entry.path)} className="text-sm text-danger" />
    <p>
      Fix <Path path={entry.path} /> by hand; the item shows here again once it can be read.
    </p>
  </>
);

/** What an item's tab says when its binder isn't listed. */
export const BinderNotice = ({ shown }: { shown: NoBinder }) =>
  shown.kind === "binder-missing" ? (
    <Notice>
      <p>
        This item's binder can't be found: its folder was deleted or its {SETTINGS_FILE} can't be read. These binders can't be read; if one of them is this item's, fix it by hand:
      </p>
      <BrokenBinders binders={shown.broken} />
    </Notice>
  ) : (
    <Notice>
      <p>This item's binder no longer exists, so the item can't be shown. Close this tab.</p>
    </Notice>
  );
