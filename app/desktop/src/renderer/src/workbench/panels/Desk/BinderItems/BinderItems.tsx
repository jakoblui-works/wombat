import type { LenientView } from "@wombat/shared/items";

import { useBinderItems } from "../../../../data/hooks.ts";
import type { Reveal } from "../../../registry.ts";
import { EmptyState } from "../../../EmptyState/EmptyState.tsx";
import type { DeletableItem } from "../../../items/item-delete.ts";
import { READ_FAILED } from "../../Item/ItemNotice/ItemNotice.tsx";
import type { Binder } from "../../Item/item-state.ts";
import { useItemDelete } from "../../Item/use-item-delete.tsx";
import { ListView } from "../ListView/ListView.tsx";
import { TreeView } from "../TreeView/TreeView.tsx";
import type { OpenRowItem } from "../use-open-row.ts";
import { useItemProposals } from "../use-item-proposals.ts";
import { useItemsOf } from "../use-link-lists.ts";
import { type NewItem, sidebarView } from "../view-model/view-model.ts";
import { withProposals } from "../view-model/with-proposals.ts";

type Props = {
  binder: Binder;
  view: LenientView | undefined;
  onOpenItem?: OpenRowItem | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

/**
 * A binder's items and its open item proposals in its view as the sidebar shows it (`sidebarView`). A row's delete
 * question (`useItemDelete`) renders here, so it outlives the view when the binder's last item goes.
 */
export const BinderItems = (props: Props) => {
  const remove = useItemDelete();
  return (
    <>
      <BinderView {...props} onDeleteItem={remove.ask} />
      {remove.dialog}
    </>
  );
};

const BinderView = ({ binder, view, onOpenItem, onDeleteItem, onNewItem, reveal, onRevealed }: Props & { onDeleteItem: (item: DeletableItem) => void }) => {
  const [read] = useBinderItems([binder.id]);
  const proposals = useItemProposals(binder.id);
  const items = read?.data?.items;
  const itemsOf = useItemsOf(binder.id, binder.properties, items ?? []);
  if (items === undefined) {
    return read?.error ? (
      <p role="alert" className="px-3 pt-3 text-sm text-danger">
        {READ_FAILED["binder-items"]}: {read.error.message}
      </p>
    ) : (
      <p className="p-3 text-sm text-fg-tertiary">Loading…</p>
    );
  }
  const rows = withProposals(items, proposals, binder.id, itemsOf);
  if (rows.length === 0) return <EmptyState title="No items yet" body="Items are the Markdown files in the binder's folder." />;
  const shown = sidebarView(view);
  if (shown.kind === "tree")
    return <TreeView key={`${binder.id}/${shown.name}`} rows={rows} view={shown} properties={binder.properties} onOpenItem={onOpenItem} onDeleteItem={onDeleteItem} onNewItem={onNewItem} reveal={reveal} onRevealed={onRevealed} />;
  return <ListView key={`${binder.id}/${shown.name}`} rows={rows} view={shown} properties={binder.properties} onOpenItem={onOpenItem} onDeleteItem={onDeleteItem} onNewItem={onNewItem} reveal={reveal} onRevealed={onRevealed} />;
};
