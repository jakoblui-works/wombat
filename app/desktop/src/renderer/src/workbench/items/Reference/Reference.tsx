import type { BinderSummary } from "@wombat/shared/items";

import { useWorkbench } from "../../workbench-context.ts";
import { useHoverPreview } from "../ItemPreview/HoverPreview.tsx";

/** The prefixes of the listed binders, which references in text are to. */
export const referencePrefixes = (binders: readonly BinderSummary[] | undefined): string[] =>
  (binders ?? []).flatMap((binder) => (binder.id === null ? [] : [binder.prefix]));

/** A reference to item `handle` in text: its preview on hover or focus, and a click follows it to the item. */
export const Reference = ({ handle }: { handle: string }) => {
  const { followItem } = useWorkbench();
  const follow = () => followItem(handle);
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
