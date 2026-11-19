import { useQueryClient } from "@tanstack/react-query";
import { type Item as ItemData, type ItemSummary, type LenientProperty, SETTINGS_FILE } from "@wombat/shared/items";
import { type ReactNode, useCallback, useEffect, useReducer, useState } from "react";

import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { useSaveItem } from "../../../data/commands.ts";
import { useBinderItems, useBinders, useItem } from "../../../data/hooks.ts";
import { itemQuery } from "../../../data/query-client.ts";
import { asError } from "../../../lib/errors.ts";
import { lastPathPart } from "../../../lib/path.ts";
import type { PanelProps } from "../../registry.ts";
import { useCloseGuard, useWorkbench } from "../../workbench-context.ts";
import { Note } from "../approvals/Note/Note.tsx";
import { ProblemList } from "../Desk/ProblemList/ProblemList.tsx";
import { problemsByField } from "../Desk/view-model/problems.ts";
import { linkValue } from "../Desk/view-model/values.ts";
import { Body } from "./Body/Body.tsx";
import { CloseDialog } from "./CloseDialog/CloseDialog.tsx";
import { Conflict } from "./Conflict/Conflict.tsx";
import { linkTarget, valueText } from "./fields/field-input.ts";
import { Fields } from "./fields/Fields.tsx";
import { propertyRows } from "./fields/property-rows.ts";
import {
  canSave,
  changedFields,
  conflicts,
  type FieldValue,
  fileChanged,
  initialEdit,
  isSaving,
  type ItemEditState,
  itemEdit,
  saveFailure,
  saveProblems,
  saveRequest,
  valueOf,
} from "./item-edit.ts";
import { ITEM_PANEL, ItemParams, itemTitle, type SavedItemParams } from "./item-params.ts";
import { type BrokenBinder, type ItemShown, itemShown, lastKnown, listedBinder, settingsPath, usable } from "./item-state.ts";

const NO_PROPERTIES: Readonly<Record<string, LenientProperty>> = {};

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

type Listed = (binderId: string) => readonly ItemSummary[] | undefined;

const Content = ({ shown }: { shown: Exclude<ItemShown, { kind: "loading" }> }) => {
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
        {known === undefined ? (
          <Content shown={shown} />
        ) : (
          <EditItem
            key={itemId}
            tab={{ binderId, itemId }}
            shown={shown}
            item={known}
            binderName={binder?.name}
            properties={properties}
            listed={listed}
            onOpenItem={openItem}
          />
        )}
      </article>
    </ScrollArea>
  );
};

const Meta = ({ item, binderName }: { item: ItemData; binderName: string | undefined }) => (
  <p className="flex items-center gap-2 text-sm text-fg-tertiary">
    {item.handle === null ? null : <span className="font-mono text-xs text-fg-secondary">{item.handle}</span>}
    {item.handle === null || binderName === undefined ? null : <span aria-hidden>·</span>}
    {binderName === undefined ? null : <span>{binderName}</span>}
  </p>
);

const fieldLabel = (field: string): string => (field === "title" ? "Title" : field === "body" ? "Body" : field);

/**
 * The item's fields and body as I edit them, from the first read on: my changes stay while the tab can't show the item
 * (its notice above them, Save off) and the close still asks. Decisions are `itemEdit`'s; this runs the saves and the
 * reread.
 */
const EditItem = ({
  tab,
  shown,
  item,
  binderName,
  properties,
  listed,
  onOpenItem,
}: {
  tab: SavedItemParams;
  shown: Exclude<ItemShown, { kind: "loading" }>;
  /** The item as last read. */
  item: ItemData;
  binderName: string | undefined;
  properties: Readonly<Record<string, LenientProperty>>;
  listed: Listed;
  onOpenItem: (binderId: string, itemId: string) => void;
}) => {
  const [state, dispatch] = useReducer(itemEdit, item, initialEdit);
  const fresh = shown.kind === "item" ? shown.item : undefined;
  useEffect(() => {
    if (fresh !== undefined) dispatch({ type: "refreshed", item: fresh });
  }, [fresh]);
  const showable = fresh !== undefined;
  const queryClient = useQueryClient();
  const save = useSaveItem();
  const { closeTab } = useWorkbench();

  const send = (from: ItemEditState) => {
    dispatch({ type: "saving" });
    save.mutate(
      { ref: tab.itemId, ...saveRequest(from) },
      {
        onSuccess: (written) => dispatch({ type: "saved", item: written }),
        onError: (error) => {
          const failure = saveFailure(error);
          if (failure !== "stale") {
            dispatch({ type: "refused", problems: failure });
            return;
          }
          queryClient.fetchQuery({ ...itemQuery(tab.itemId), staleTime: 0 }).then(
            (now) => dispatch({ type: "stale", item: now }),
            (reread: unknown) => dispatch({ type: "refused", problems: [{ message: asError(reread).message }] }),
          );
        },
      },
    );
  };
  const edit = (field: string, value: FieldValue) => dispatch({ type: "edit", field, value });

  const changed = Object.keys(changedFields(state)).length > 0;
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  useCloseGuard({ panelId: ITEM_PANEL, params: tab }, changed ? ask : undefined);

  const file = lastPathPart(item.path);
  const fileLink = (field: string) => linkValue(Object.hasOwn(item.properties, field) ? item.properties[field] : undefined);
  const names = Object.keys(properties);
  const { rows, rest } = propertyRows(properties, showable ? item : { problems: [] });
  const refused = problemsByField(saveProblems(state), [...names, "title", "body"]);
  const titleProblems = refused.at.get("title") ?? [];
  const text = (field: string, value: FieldValue) => {
    const property = properties[field];
    return valueText(property, value, property?.type === "link" ? linkTarget(value, listed(property.to), fileLink(field)) : undefined);
  };
  const conflictEntries = conflicts(state).map(({ field, mine, theirs }) => ({ field, label: fieldLabel(field), mine: text(field, mine), theirs: text(field, theirs), long: field === "body" }));

  return (
    <>
      <Content shown={shown} />
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Meta item={item} binderName={binderName} />
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" disabled={!changed || isSaving(state)} onClick={() => dispatch({ type: "discard" })}>
              Discard
            </Button>
            <Button type="button" disabled={!showable || !canSave(state)} onClick={() => send(state)}>
              Save
            </Button>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-fg-primary">
          <input
            aria-label="Title"
            aria-invalid={titleProblems.length > 0}
            className="focus-ring -mx-1.5 w-[calc(100%+0.75rem)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 hover:border-line-strong focus:border-line-strong"
            value={valueOf(state, "title") ?? ""}
            onChange={(event) => edit("title", event.target.value)}
          />
        </h1>
        <ProblemList problems={titleProblems} file={file} className="text-sm text-danger" />
      </header>
      {fileChanged(state) ? (
        <div role="status" className="rounded-md border border-state-waiting/40 bg-surface-2 px-3 py-2.5 text-sm text-fg-secondary">
          This item's file changed since you started editing. Your changes are kept here; Save shows where they differ from the file.
        </div>
      ) : null}
      {conflictEntries.length === 0 ? null : (
        <Conflict
          entries={conflictEntries}
          onTakeTheirs={(field) => dispatch({ type: "takeTheirs", field })}
          keepable={showable}
          onKeepMine={() => {
            const mine = itemEdit(state, { type: "keepMine" });
            dispatch({ type: "keepMine" });
            if (Object.keys(changedFields(mine)).length > 0) send(mine);
          }}
        />
      )}
      {rest.length + refused.rest.length === 0 ? null : (
        <div className="rounded-md border border-danger/40 bg-danger-subtle px-3 py-2.5">
          <ProblemList problems={[...rest, ...refused.rest]} file={file} className="text-sm text-danger" />
        </div>
      )}
      {rows.length === 0 ? null : (
        <Fields
          rows={rows}
          properties={properties}
          valueOf={(field) => valueOf(state, field)}
          onEdit={edit}
          saveProblems={refused.at}
          file={file}
          listed={listed}
          onOpenItem={onOpenItem}
          fileLink={fileLink}
        />
      )}
      <Body path={item.path} file={file} text={String(valueOf(state, "body") ?? "")} onChange={(body) => edit("body", body)} problems={refused.at.get("body") ?? []} />
      <CloseDialog
        name={itemTitle(item)}
        open={asking}
        onCancel={() => setAsking(false)}
        onClose={() => {
          setAsking(false);
          closeTab(ITEM_PANEL, tab);
        }}
      />
    </>
  );
};

/** An item as a tab: its handle, title and binder, its properties and body to edit, and its problems. */
export const Item = ({ params, setTitle }: PanelProps) => {
  const parsed = ItemParams.safeParse(params);
  return parsed.success ? <ItemTab {...parsed.data} setTitle={setTitle} /> : <Note>This tab names no item; close it.</Note>;
};
