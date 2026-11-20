import type { BinderSummary, LenientView } from "@wombat/shared/items";

import { useBinderItems } from "../../../../data/hooks.ts";
import type { Reveal } from "../../../registry.ts";
import { EmptyState } from "../../EmptyState/EmptyState.tsx";
import { ListView } from "../ListView/ListView.tsx";
import { TreeView } from "../TreeView/TreeView.tsx";
import { useItemProposals } from "../use-item-proposals.ts";
import { useItemsOf } from "../use-link-lists.ts";
import { type NewItem, sidebarView } from "../view-model/view-model.ts";
import { withProposals } from "../view-model/with-proposals.ts";

type Props = {
  binder: Extract<BinderSummary, { id: string }>;
  view: LenientView | undefined;
  onOpenItem?: ((itemId: string) => void) | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

/** A binder's items and its open item proposals in its view as the sidebar shows it (`sidebarView`). */
export const BinderItems = ({ binder, view, onOpenItem, onNewItem, reveal, onRevealed }: Props) => {
  const [read] = useBinderItems([binder.id]);
  const proposals = useItemProposals(binder.id);
  const items = read?.data?.items;
  const itemsOf = useItemsOf(binder.id, binder.properties, items ?? []);
  if (items === undefined) {
    return read?.error ? (
      <p role="alert" className="px-3 pt-3 text-sm text-danger">
        Couldn't read the binder's items: {read.error.message}
      </p>
    ) : (
      <p className="p-3 text-sm text-fg-tertiary">Loading…</p>
    );
  }
  const rows = withProposals(items, proposals, binder.id, itemsOf);
  if (rows.length === 0) return <EmptyState title="No items yet" body="Items are the Markdown files in the binder's folder." />;
  const shown = sidebarView(view);
  if (shown.kind === "tree")
    return <TreeView key={shown.name} rows={rows} view={shown} properties={binder.properties} onOpenItem={onOpenItem} onNewItem={onNewItem} reveal={reveal} onRevealed={onRevealed} />;
  return <ListView rows={rows} view={shown} properties={binder.properties} onOpenItem={onOpenItem} onNewItem={onNewItem} reveal={reveal} onRevealed={onRevealed} />;
};
