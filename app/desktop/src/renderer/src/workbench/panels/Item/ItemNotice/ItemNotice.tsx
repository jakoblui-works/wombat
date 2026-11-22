import { type ItemSummary, SETTINGS_FILE } from "@wombat/shared/items";

import { lastPathPart } from "../../../../lib/path.ts";
import { settingsPath } from "../../../items/binders.ts";
import { BinderNotice, Notice, Path, READ_FAILED, UnparseableItem } from "../../../items/notices/notices.tsx";
import { ProblemList } from "../../../items/ProblemList/ProblemList.tsx";
import type { ItemShown } from "../item-state.ts";

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

/** What the tab says about the item when it can't show it as read; nothing while it can. */
export const ItemNotice = ({ shown }: { shown: Exclude<ItemShown, { kind: "loading" }> }) => {
  switch (shown.kind) {
    case "item":
      return null;
    case "unparseable":
      return (
        <Notice>
          <UnparseableItem entry={shown.entry} />
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
    case "binder-gone":
      return <BinderNotice shown={shown} />;
    case "error":
      return (
        <p role="alert" className="text-sm text-danger">
          {READ_FAILED[shown.what]}: {shown.message}
        </p>
      );
  }
};
