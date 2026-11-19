import { SETTINGS_FILE } from "@wombat/shared/items";

import { ScrollArea } from "../../../components/ui/scroll-area";
import { useBinders } from "../../../data/hooks.ts";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { useDesk, useWorkbench } from "../../workbench-context.ts";
import { EmptyState } from "../EmptyState/EmptyState.tsx";
import { BinderView } from "./BinderView/BinderView.tsx";
import { toggleDrawer } from "./desk-tree.ts";
import { deskContent, showTree } from "./desk-view.ts";
import { DeskTree } from "./DeskTree/DeskTree.tsx";

/** The Desk's sidebar: the tree of drawers and binders, or one binder in place of it. */
export const Desk = () => {
  const binders = useBinders();
  const { desk, changeDesk } = useDesk();
  const { openBinder, openItem } = useWorkbench();
  const content = deskContent(binders.data?.binders, binders.error, desk);

  if (content.kind === "binder") {
    const { binder, view } = content;
    return (
      <BinderView
        binder={binder}
        view={view}
        onBack={() => changeDesk(showTree)}
        onView={(name) => openBinder(binder.id, undefined, name)}
        onOpenItem={(itemId) => openItem(binder.id, itemId)}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarHeader title="Desk" />
      {content.kind === "loading" ? (
        <p className="p-3 text-sm text-fg-tertiary">Loading…</p>
      ) : content.kind === "error" ? (
        <p role="alert" className="px-3 pt-3 text-sm text-danger">
          Couldn't read the binders: {content.message}
        </p>
      ) : content.kind === "no-root" ? (
        <div className="min-h-0 flex-1">
          <EmptyState symbol title="No items folder" body="Set WOMBAT_ITEMS to the absolute path of your items folder and restart the service." />
        </div>
      ) : content.kind === "empty" ? (
        <div className="min-h-0 flex-1">
          <EmptyState symbol title="No binders yet" body={`A binder is a folder with a ${SETTINGS_FILE} file. Add one to the items folder to see it here.`} />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <DeskTree
            nodes={content.nodes}
            openDrawers={desk.openDrawers}
            onToggleDrawer={(path, open) => changeDesk((current) => ({ ...current, openDrawers: toggleDrawer(current.openDrawers, path, open) }))}
            onOpenBinder={(binderId) => openBinder(binderId)}
          />
        </ScrollArea>
      )}
    </div>
  );
};
