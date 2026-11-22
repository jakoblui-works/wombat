import type { BinderSummary } from "@wombat/shared/items";
import type { ReactNode } from "react";

import { ReferenceProvider } from "../../../components/Markdown/ReferenceProvider.tsx";
import { useBinders } from "../../../data/hooks.ts";
import { useHoverPreview } from "../ItemPreview/HoverPreview.tsx";
import { useItemNavigation } from "../navigation/item-navigation.ts";
import { SurfaceWorkspaceContext, useSurfaceWorkspace } from "../surface-workspace.ts";

/** The prefixes of the listed binders, which references in text are to. */
export const referencePrefixes = (binders: readonly BinderSummary[] | undefined): string[] =>
  (binders ?? []).flatMap((binder) => (binder.id === null ? [] : [binder.prefix]));

/** A reference to item `handle` in text: its preview on hover or focus, and a click follows it to the item. */
export const Reference = ({ handle }: { handle: string }) => {
  const ws = useSurfaceWorkspace();
  const { followItem } = useItemNavigation();
  const follow = () => {
    if (ws !== undefined) followItem(ws, handle);
  };
  const preview = useHoverPreview({ itemRef: handle, onOpen: follow });
  return (
    <>
      {preview.trigger(
        <button
          type="button"
          className="focus-ring cursor-pointer rounded-xs font-mono text-[0.9em] text-fg-primary underline decoration-line-strong decoration-dotted underline-offset-2 hover:decoration-fg-secondary"
          onClick={follow}
        >
          {handle}
        </button>,
      )}
      {preview.box}
    </>
  );
};

const renderReference = (handle: string) => <Reference handle={handle} />;

/**
 * A surface of workspace `ws` (undefined while unknown): the references in its text are to that workspace's binders,
 * and its previews and follows read that workspace's items.
 */
export const SurfaceWorkspace = ({ ws, children }: { ws: string | undefined; children: ReactNode }) => {
  const prefixes = referencePrefixes(useBinders(ws).data?.binders);
  return (
    <SurfaceWorkspaceContext value={ws}>
      <ReferenceProvider prefixes={prefixes} render={renderReference}>
        {children}
      </ReferenceProvider>
    </SurfaceWorkspaceContext>
  );
};
