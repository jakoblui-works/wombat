import { type Item as ItemData, type ItemSummary, type LenientProperty, SETTINGS_FILE } from "@wombat/shared/items";
import { type ReactNode, useEffect } from "react";

import { ScrollArea } from "../../../components/ui/scroll-area";
import { useBinderItems, useBinders, useItem } from "../../../data/hooks.ts";
import { lastPathPart } from "../../../lib/path.ts";
import type { PanelProps } from "../../registry.ts";
import { useWorkbench } from "../../workbench-context.ts";
import { Note } from "../approvals/Note/Note.tsx";
import { Body } from "./Body/Body.tsx";
import { ProblemList } from "../Desk/ProblemList/ProblemList.tsx";
import { Fields } from "./fields/Fields.tsx";
import { propertyRows } from "./fields/property-rows.ts";
import { ItemParams, itemName, itemTitle, type SavedItemParams } from "./item-params.ts";
import { type BrokenBinder, type ItemShown, itemShown, lastKnown, listedBinder, settingsPath, usable } from "./item-state.ts";

const NO_PROPERTIES: Readonly<Record<string, LenientProperty>> = {};

const READ_FAILED = { item: "Couldn't read the item", binders: "Couldn't read the binders", "binder-items": "Couldn't read the binder's items" } as const;

const Header = ({ item, binderName }: { item: ItemData; binderName: string | undefined }) => (
  <header className="flex flex-col gap-1">
    <p className="flex items-center gap-2 text-sm text-fg-tertiary">
      {item.handle === null ? null : <span className="font-mono text-xs text-fg-secondary">{item.handle}</span>}
      {item.handle === null || binderName === undefined ? null : <span aria-hidden>·</span>}
      {binderName === undefined ? null : <span>{binderName}</span>}
    </p>
    <h1 className="text-xl font-semibold text-fg-primary">{itemName(item)}</h1>
  </header>
);

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

type Listed = (binderId: string) => readonly ItemSummary[] | undefined;

const Content = ({ shown, listed, onOpenItem }: { shown: Exclude<ItemShown, { kind: "loading" }>; listed: Listed; onOpenItem: (binderId: string, itemId: string) => void }) => {
  switch (shown.kind) {
    case "item":
      return <Valid item={shown.item} properties={shown.binder.properties} listed={listed} onOpenItem={onOpenItem} />;
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

const ItemTab = ({ binderId, itemId, setTitle }: SavedItemParams & { setTitle: PanelProps["setTitle"] }) => {
  const item = useItem(itemId);
  const binders = useBinders();
  const { openItem } = useWorkbench();
  const [own] = useBinderItems([binderId]);
  const shown = itemShown(itemId, binderId, {
    item: { data: item.data, error: item.error },
    binders: { data: binders.data?.binders, error: binders.error },
    listed: { data: own?.data?.items, error: own?.error },
  });
  const binder = listedBinder(shown);
  const properties = binder?.properties ?? NO_PROPERTIES;
  const listIds = [...new Set(Object.values(properties).flatMap((property) => (property.type === "link" ? [property.to] : [])))];
  const lists = useBinderItems(listIds);
  const listed: Listed = (id) => {
    const list = lists[listIds.indexOf(id)];
    return usable({ data: list?.data?.items, error: list?.error });
  };

  const known = lastKnown(shown);
  const title = known === undefined ? undefined : itemTitle(known);
  useEffect(() => {
    if (title !== undefined) setTitle?.(title);
  }, [title, setTitle]);

  if (shown.kind === "loading") return <Note>Loading…</Note>;
  return (
    <ScrollArea className="h-full min-h-0">
      <article className="mx-auto flex max-w-chat flex-col gap-5 px-5 pt-6 pb-10">
        {known === undefined ? null : <Header item={known} binderName={binder?.name} />}
        <Content shown={shown} listed={listed} onOpenItem={openItem} />
      </article>
    </ScrollArea>
  );
};

const Valid = ({
  item,
  properties,
  listed,
  onOpenItem,
}: {
  item: ItemData;
  properties: Readonly<Record<string, LenientProperty>>;
  listed: Listed;
  onOpenItem: (binderId: string, itemId: string) => void;
}) => {
  const file = lastPathPart(item.path);
  const { rows, rest } = propertyRows(properties, item, listed);
  return (
    <>
      {rest.length === 0 ? null : (
        <div className="rounded-md border border-danger/40 bg-danger-subtle px-3 py-2.5">
          <ProblemList problems={rest} file={file} className="text-sm text-danger" />
        </div>
      )}
      {rows.length === 0 ? null : <Fields rows={rows} file={file} onOpenItem={onOpenItem} />}
      <Body text={item.body} />
    </>
  );
};

/** An item as a tab, read-only: its handle, title and binder, its properties, its body and its problems. */
export const Item = ({ params, setTitle }: PanelProps) => {
  const parsed = ItemParams.safeParse(params);
  return parsed.success ? <ItemTab {...parsed.data} setTitle={setTitle} /> : <Note>This tab names no item; close it.</Note>;
};
