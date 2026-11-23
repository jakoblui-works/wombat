import { type BinderSummary, SETTINGS_FILE } from "@wombat/shared/items";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { useBinders } from "../../../data/hooks.ts";
import { runLogged } from "../../commands/registry.ts";
import { WORKBENCH_COMMAND } from "../../commands/workbench-commands.ts";
import { SurfaceWorkspace } from "../../items/Reference/Reference.tsx";
import { NavigatorParams, type PanelProps } from "../../registry.ts";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { EmptyState } from "../../EmptyState/EmptyState.tsx";
import { READ_FAILED } from "../../items/notices/notices.tsx";
import { useDesk } from "../../items/navigation/desk-state.ts";
import { useItemNavigation } from "../../items/navigation/item-navigation.ts";
import { BinderPane } from "./BinderPane/BinderPane.tsx";
import { revealBinder, toggleDrawer } from "./desk-tree.ts";
import { deskContent, showTree } from "./desk-place.ts";
import { DeskTree } from "./DeskTree/DeskTree.tsx";
import { NewBinder } from "./NewBinder/NewBinder.tsx";

/** The Desk's navigator, on the workspace its params name. */
export const Desk = (props: PanelProps) => {
  const { ws } = NavigatorParams.parse(props.params);
  return (
    <SurfaceWorkspace ws={ws}>
      <WorkspaceDesk ws={ws} {...props} />
    </SurfaceWorkspace>
  );
};

const LOADING = <p className="p-3 text-sm text-fg-tertiary">Loading…</p>;

/** The tree of workspace `ws`'s drawers and binders, or one binder in place of it. */
const WorkspaceDesk = ({ ws, reveal, onRevealed }: PanelProps & { ws: string }) => {
  const binders = useBinders(ws);
  const { desk, changeDesk } = useDesk();
  const { openBinder, openItem, openNewItem } = useItemNavigation();
  const content = deskContent(binders.data?.binders, binders.error, desk);
  const [newBinder, setNewBinder] = useState<{ open: boolean; drawer: string }>({ open: false, drawer: "" });
  const [focusKey, setFocusKey] = useState<string>();
  const clearFocusKey = useCallback(() => setFocusKey(undefined), []);
  const openNewBinder = (drawer: string) => setNewBinder({ open: true, drawer });

  const created = (binder: BinderSummary) => {
    setNewBinder((current) => ({ ...current, open: false }));
    const known = (binders.data?.binders ?? []).filter((other) => other.path !== binder.path);
    changeDesk((current) => ({ ...current, openDrawers: revealBinder([...known, binder], current.openDrawers, binder.path) }));
    setFocusKey(binder.path);
  };

  if (content.kind === "binder") {
    const { binder, view } = content;
    return (
      <BinderPane
        binder={binder}
        view={view}
        onBack={() => changeDesk(showTree)}
        onView={(name) => openBinder(ws, binder.id, undefined, name)}
        onOpenItem={(itemId, options) => openItem(ws, binder.id, itemId, options)}
        onNewItem={(context) => openNewItem(ws, binder.id, context)}
        reveal={reveal}
        onRevealed={onRevealed}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarHeader title="Desk">
        {content.kind === "tree" ? (
          <Button variant="ghost" size="xs" className="text-fg-secondary" aria-label="New binder" title="New binder" onClick={() => openNewBinder("")}>
            <Plus />
            New
          </Button>
        ) : null}
      </SidebarHeader>
      {content.kind === "loading" ? (
        LOADING
      ) : content.kind === "error" ? (
        <p role="alert" className="px-3 pt-3 text-sm text-danger">
          {READ_FAILED.binders}: {content.message}
        </p>
      ) : content.kind === "no-root" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto overscroll-y-contain pb-4">
          <div>
            <EmptyState symbol title="No items folder" body="The items folder is the folder that holds your binders. Choose it to see them here." />
          </div>
          <Button onClick={() => runLogged(WORKBENCH_COMMAND.chooseItemsFolder)}>Choose items folder…</Button>
        </div>
      ) : content.kind === "empty" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto overscroll-y-contain pb-4">
          <div>
            <EmptyState symbol title="No binders yet" body={`A binder is a folder with a ${SETTINGS_FILE} file. Add one to the items folder to see it here.`} />
          </div>
          <Button onClick={() => openNewBinder("")}>New binder</Button>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <DeskTree
            nodes={content.nodes}
            openDrawers={desk.openDrawers}
            onToggleDrawer={(path, open) => changeDesk((current) => ({ ...current, openDrawers: toggleDrawer(current.openDrawers, path, open) }))}
            onOpenBinder={(binderId) => openBinder(ws, binderId)}
            onNewBinder={openNewBinder}
            focusKey={focusKey}
            onFocused={clearFocusKey}
          />
        </ScrollArea>
      )}
      <NewBinder ws={ws} open={newBinder.open} drawer={newBinder.drawer} onCancel={() => setNewBinder((current) => ({ ...current, open: false }))} onCreated={created} />
    </div>
  );
};
