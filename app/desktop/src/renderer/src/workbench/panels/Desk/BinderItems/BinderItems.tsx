import type { BinderSummary, LenientView } from "@wombat/shared/items";

import { useBinderItems } from "../../../../data/hooks.ts";
import { EmptyState } from "../../EmptyState/EmptyState.tsx";
import { ListView } from "../ListView/ListView.tsx";
import { TreeView } from "../TreeView/TreeView.tsx";
import { type NewItem, paneView } from "../view-model/view-model.ts";

type Props = {
  binder: Extract<BinderSummary, { id: string }>;
  view: LenientView | undefined;
  onOpenItem?: ((itemId: string) => void) | undefined;
  onNewItem: NewItem;
};

/** A binder's items in its list or tree view; without one, as a plain list. */
export const BinderItems = ({ binder, view, onOpenItem, onNewItem }: Props) => {
  const [read] = useBinderItems([binder.id]);
  const items = read?.data?.items;
  if (items === undefined) {
    return read?.error ? (
      <p role="alert" className="px-3 pt-3 text-sm text-danger">
        Couldn't read the binder's items: {read.error.message}
      </p>
    ) : (
      <p className="p-3 text-sm text-fg-tertiary">Loading…</p>
    );
  }
  if (items.length === 0) return <EmptyState title="No items yet" body="Items are the Markdown files in the binder's folder." />;
  const shown = paneView(view);
  if (shown.kind === "tree") return <TreeView key={shown.name} items={items} view={shown} properties={binder.properties} onOpenItem={onOpenItem} onNewItem={onNewItem} />;
  return <ListView items={items} view={shown} properties={binder.properties} onOpenItem={onOpenItem} onNewItem={onNewItem} />;
};
