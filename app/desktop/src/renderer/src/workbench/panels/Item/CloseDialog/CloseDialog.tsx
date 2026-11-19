import { useRef } from "react";

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../../../../components/ui/alert-dialog";
import { Button } from "../../../../components/ui/button";

type Props = { name: string; open: boolean; onCancel: () => void; onClose: () => void };

/** Asks before a tab with unsaved changes closes (focus starts on Keep editing). */
export const CloseDialog = ({ name, open, onCancel, onClose }: Props) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogTitle>Close {name} without saving?</AlertDialogTitle>
        <AlertDialogDescription>Your changes to this item aren't saved. Closing the tab discards them.</AlertDialogDescription>
        <AlertDialogFooter>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={onCancel}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onClose}>
            Discard and close
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
