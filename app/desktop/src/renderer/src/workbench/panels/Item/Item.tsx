import { useQueryClient } from "@tanstack/react-query";
import type { Item as ItemData, ItemSummary, LenientProperty } from "@wombat/shared/items";
import type { ItemProposal } from "@wombat/shared/proposals";
import { useCallback, useEffect, useReducer, useState } from "react";

import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { useCreateItem, useSaveItem } from "../../../data/commands.ts";
import { useBinderItems, useBinders, useItem, useProposals } from "../../../data/hooks.ts";
import { itemQuery } from "../../../data/query-client.ts";
import { writeFailure } from "../../../data/write-failure.ts";
import { asError } from "../../../lib/errors.ts";
import { lastPathPart } from "../../../lib/path.ts";
import type { PanelProps } from "../../registry.ts";
import { useCloseGuard, useWorkbench } from "../../workbench-context.ts";
import { Note } from "../approvals/Note/Note.tsx";
import { Field } from "../Desk/Field/Field.tsx";
import { ProblemList } from "../Desk/ProblemList/ProblemList.tsx";
import { problemsByField } from "../Desk/view-model/problems.ts";
import { linkedBinders, linkValue } from "../Desk/view-model/values.ts";
import { proposalsOnItem } from "../Desk/view-model/with-proposals.ts";
import { Body } from "./Body/Body.tsx";
import { CloseDialog } from "./CloseDialog/CloseDialog.tsx";
import { Conflict } from "./Conflict/Conflict.tsx";
import { FileName } from "./FileName/FileName.tsx";
import { linkTarget, valueText } from "./fields/field-input.ts";
import { Fields } from "./fields/Fields.tsx";
import { ItemActions } from "./ItemActions/ItemActions.tsx";
import { ItemNotice } from "./ItemNotice/ItemNotice.tsx";
import { ProposalBanner } from "./ProposalBanner/ProposalBanner.tsx";
import { propertyRows } from "./fields/property-rows.ts";
import {
  canSave,
  changedFields,
  conflicts,
  createRequest,
  draftStart,
  edited,
  type FieldValue,
  fileChanged,
  initialEdit,
  isSaving,
  type ItemEditState,
  itemEdit,
  saveProblems,
  saveRequest,
  valueOf,
} from "./item-edit.ts";
import { type DraftItemParams, ITEM_PANEL, ItemParams, itemTitle, type SavedItemParams } from "./item-params.ts";
import { type Binder, draftShown, type ItemForm, itemForm, type ItemShown, itemShown, lastKnown, listedBinder, usable } from "./item-state.ts";

const NO_PROPERTIES: Readonly<Record<string, LenientProperty>> = {};

/** The field a refused file name's problems name. */
const FILE_FIELD = "file";

type Listed = (binderId: string) => readonly ItemSummary[] | undefined;

/** The items of the binders the properties link to, by binder id; `pending` while one hasn't been read yet. */
const useLinkLists = (properties: Readonly<Record<string, LenientProperty>>): { listed: Listed; pending: boolean } => {
  const listIds = linkedBinders(properties);
  const lists = useBinderItems(listIds);
  const listed: Listed = (id) => {
    const list = lists[listIds.indexOf(id)];
    return usable({ data: list?.data?.items, error: list?.error });
  };
  return { listed, pending: lists.some((list) => list.isPending) };
};

/** The binder `binder` names now, else the last one it named. */
const useLastListed = (binder: Binder | undefined): Binder | undefined => {
  const [last, setLast] = useState(binder);
  if (binder !== undefined && binder !== last) setLast(binder);
  return binder ?? last;
};

/** What an item form edits: an item read from its file, or a draft with the context it was opened with. */
type Editing = { kind: "saved"; tab: SavedItemParams } | { kind: "draft"; tab: DraftItemParams };

/**
 * An item tab's content, for both kinds of tab: the read's notice, and the form (`itemForm`) from the first read until
 * the tab closes, so my edits and the close guard outlive an item or binder that can't be shown for a while.
 */
const ItemTabBody = ({ shown, editing, proposals = [] }: { shown: ItemShown; editing: Editing; proposals?: readonly ItemProposal[] }) => {
  const { openItem } = useWorkbench();
  const form = itemForm(shown, useLastListed(listedBinder(shown)), editing.kind === "draft");
  const properties = form?.binder?.properties ?? NO_PROPERTIES;
  const links = useLinkLists(properties);
  const [start, setStart] = useState<Record<string, FieldValue>>();
  if (editing.kind === "draft" && start === undefined && form !== undefined && !links.pending) setStart(draftStart(editing.tab.context, properties, links.listed));
  const ready = form !== undefined && (editing.kind === "saved" || start !== undefined);

  if (!ready && (shown.kind === "loading" || form !== undefined)) return <Note>Loading…</Note>;
  return (
    <ScrollArea className="h-full min-h-0">
      <article className="mx-auto flex max-w-chat flex-col gap-5 px-5 pt-6 pb-10">
        {shown.kind === "loading" ? null : <ItemNotice shown={shown} />}
        {proposals.map((proposal) => (
          <ProposalBanner key={proposal.id} proposal={proposal} />
        ))}
        {ready ? (
          <EditItem
            editing={editing}
            form={form}
            fresh={editing.kind === "saved" && shown.kind === "item" ? shown.item : undefined}
            start={start}
            properties={properties}
            listed={links.listed}
            onOpenItem={openItem}
          />
        ) : null}
      </article>
    </ScrollArea>
  );
};

const ItemTab = ({ binderId, itemId, setTitle }: SavedItemParams & { setTitle: PanelProps["setTitle"] }) => {
  const item = useItem(itemId);
  const binders = useBinders();
  const [own] = useBinderItems([binderId]);
  const shown = itemShown(itemId, binderId, {
    item: { data: item.data, error: item.error },
    binders: { data: binders.data?.binders, error: binders.error },
    listed: { data: own?.data?.items, error: own?.error },
  });

  const known = lastKnown(shown);
  const title = known === undefined ? undefined : itemTitle(known);
  const listedProposals = useProposals();
  const proposals = proposalsOnItem(listedProposals.data?.proposals ?? [], binderId, known?.handle ?? null);
  useEffect(() => {
    if (title !== undefined) setTitle?.(title);
  }, [title, setTitle]);

  return <ItemTabBody shown={shown} editing={{ kind: "saved", tab: { binderId, itemId } }} proposals={proposals} />;
};

/** A new item's tab: the item form on no file, its context's values set, written on the first Save. */
const DraftTab = (params: DraftItemParams) => {
  const binders = useBinders();
  const shown = draftShown(params.binderId, { data: binders.data?.binders, error: binders.error });
  return <ItemTabBody shown={shown} editing={{ kind: "draft", tab: params }} />;
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
 * (its notice above them, Save off) and the close still asks. A draft's first Save creates the item, and its tab becomes
 * the item's. Decisions are `itemEdit`'s; this runs the saves, the reread and the delete.
 */
const EditItem = ({
  editing,
  form: { item, binder, savable },
  fresh,
  start,
  properties,
  listed,
  onOpenItem,
}: {
  editing: Editing;
  form: ItemForm;
  /** The item as read now; undefined while the tab can't show it (and for a draft). */
  fresh: ItemData | undefined;
  /** A draft's starting values (`draftStart`). */
  start: Readonly<Record<string, FieldValue>> | undefined;
  properties: Readonly<Record<string, LenientProperty>>;
  listed: Listed;
  onOpenItem: (binderId: string, itemId: string) => void;
}) => {
  const { tab } = editing;
  const [state, dispatch] = useReducer(itemEdit, undefined, () => initialEdit(item, start));
  useEffect(() => {
    if (fresh !== undefined) dispatch({ type: "refreshed", item: fresh });
  }, [fresh]);
  const queryClient = useQueryClient();
  const save = useSaveItem();
  const create = useCreateItem();
  const { closeTab, replaceTab } = useWorkbench();
  const [fileName, setFileName] = useState("");
  const [staleDelete, setStaleDelete] = useState(false);
  const asksFile = editing.kind === "draft" && binder?.naming === "free";

  const refuse = (error: unknown) => {
    const failure = writeFailure(error);
    dispatch({ type: "refused", problems: failure === "stale" ? [{ message: asError(error).message }] : failure });
  };
  const send = (from: ItemEditState) => {
    dispatch({ type: "saving" });
    if (editing.kind === "draft") {
      create.mutate(
        { binderId: tab.binderId, ...createRequest(from, asksFile ? fileName : "") },
        {
          onSuccess: (written) => {
            if (written.id === null) {
              dispatch({ type: "refused", problems: [{ message: "The item was saved, but the service sent no id for it. Find it in the binder's list." }] });
              return;
            }
            replaceTab({ panelId: ITEM_PANEL, params: tab }, { panelId: ITEM_PANEL, params: { binderId: tab.binderId, itemId: written.id } satisfies SavedItemParams });
          },
          onError: refuse,
        },
      );
      return;
    }
    const { itemId } = editing.tab;
    save.mutate(
      { ref: itemId, ...saveRequest(from) },
      {
        onSuccess: (written) => dispatch({ type: "saved", item: written }),
        onError: (error) => {
          if (writeFailure(error) !== "stale") {
            refuse(error);
            return;
          }
          queryClient.fetchQuery({ ...itemQuery(itemId), staleTime: 0 }).then(
            (now) => dispatch({ type: "stale", item: now }),
            (reread: unknown) => dispatch({ type: "refused", problems: [{ message: asError(reread).message }] }),
          );
        },
      },
    );
  };
  const edit = (field: string, value: FieldValue) => dispatch({ type: "edit", field, value });

  const changed = edited(state);
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  useCloseGuard({ panelId: ITEM_PANEL, params: tab }, changed ? ask : undefined);

  const file = lastPathPart(item.path);
  const fileLink = (field: string) => linkValue(Object.hasOwn(item.properties, field) ? item.properties[field] : undefined);
  const names = Object.keys(properties);
  const { rows, rest } = propertyRows(properties, savable ? item : { problems: [] });
  const refused = problemsByField(saveProblems(state), [...names, "title", "body", ...(asksFile ? [FILE_FIELD] : [])]);
  const text = (field: string, value: FieldValue) => {
    const property = properties[field];
    return valueText(property, value, property?.type === "link" ? linkTarget(value, listed(property.to), fileLink(field)) : undefined);
  };
  const conflictEntries = conflicts(state).map(({ field, mine, theirs }) => ({ field, label: fieldLabel(field), mine: text(field, mine), theirs: text(field, theirs), long: field === "body" }));

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Meta item={item} binderName={binder?.name} />
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" disabled={!changed || isSaving(state)} onClick={() => dispatch({ type: "discard" })}>
              Discard
            </Button>
            <Button type="button" disabled={!savable || !canSave(state)} onClick={() => send(state)}>
              Save
            </Button>
            {editing.kind === "saved" && fresh !== undefined ? <ItemActions tab={editing.tab} item={fresh} onStale={setStaleDelete} /> : null}
          </div>
        </div>
        <Field label="Title" hideLabel problems={refused.at.get("title") ?? []} file={file}>
          {(control) => (
            <h1 className="text-xl font-semibold text-fg-primary">
              <input
                {...control}
                className="focus-ring -mx-1.5 w-[calc(100%+0.75rem)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 hover:border-line-strong focus:border-line-strong"
                value={valueOf(state, "title") ?? ""}
                onChange={(event) => edit("title", event.target.value)}
              />
            </h1>
          )}
        </Field>
      </header>
      {staleDelete ? (
        <div role="alert" className="rounded-md border border-state-waiting/40 bg-surface-2 px-3 py-2.5 text-sm text-fg-secondary">
          This item's file changed since you asked to delete it, so nothing was deleted. Look at the item again, then delete it if you still want to.
        </div>
      ) : null}
      {asksFile ? <FileName value={fileName} onChange={setFileName} problems={refused.at.get(FILE_FIELD) ?? []} /> : null}
      {fileChanged(state) ? (
        <div role="status" className="rounded-md border border-state-waiting/40 bg-surface-2 px-3 py-2.5 text-sm text-fg-secondary">
          This item's file changed since you started editing. Your changes are kept here; Save shows where they differ from the file.
        </div>
      ) : null}
      {conflictEntries.length === 0 ? null : (
        <Conflict
          entries={conflictEntries}
          onTakeTheirs={(field) => dispatch({ type: "takeTheirs", field })}
          keepable={savable}
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
        name={editing.kind === "draft" ? "this new item" : itemTitle(item)}
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

/** An item tab names no item or names a draft; each reads what it shows itself. */
export const Item = ({ params, setTitle }: PanelProps) => {
  const parsed = ItemParams.safeParse(params);
  if (!parsed.success) return <Note>This tab names no item; close it.</Note>;
  return "itemId" in parsed.data ? <ItemTab {...parsed.data} setTitle={setTitle} /> : <DraftTab {...parsed.data} />;
};
