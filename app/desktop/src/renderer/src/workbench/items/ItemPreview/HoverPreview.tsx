import { type ReactElement, useId, useState } from "react";

import { createPreviewCardHandle, PreviewCard, PreviewCardTrigger } from "../../../components/ui/preview-card";
import { ItemPreview, ItemPreviewContent, PREVIEW_CLOSE_DELAY_MS, PREVIEW_DELAY_MS } from "./ItemPreview.tsx";

type Options = {
  /** An item's id or handle. */
  itemRef: string;
  onOpen: () => void;
  /** While set, the box stays closed (the trigger's own popup is open). */
  disabled?: boolean | undefined;
};

/**
 * Item `itemRef`'s preview box under `trigger(element)`, on hover (and focus, when the element takes it) after a row's
 * delays; a click on the element closes it. React events from the box bubble to where `box` is rendered, not to the
 * trigger, so `box` goes outside any control a click or a press in the box mustn't reach.
 */
export const useHoverPreview = ({ itemRef, onOpen, disabled = false }: Options) => {
  const [handle] = useState(() => createPreviewCardHandle());
  const [open, setOpen] = useState(false);
  const id = useId();
  return {
    trigger: (element: ReactElement) => (
      <PreviewCardTrigger handle={handle} id={id} delay={PREVIEW_DELAY_MS} closeDelay={PREVIEW_CLOSE_DELAY_MS} render={element} onClick={() => setOpen(false)} />
    ),
    box: (
      <PreviewCard handle={handle} open={open && !disabled} triggerId={id} onOpenChange={(opened) => setOpen(opened && !disabled)}>
        <ItemPreviewContent side="bottom" align="start">
          <ItemPreview
            itemRef={itemRef}
            onOpen={() => {
              setOpen(false);
              onOpen();
            }}
          />
        </ItemPreviewContent>
      </PreviewCard>
    ),
  };
};
