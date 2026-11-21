import type { Problem } from "@wombat/shared/items";
import { useRef } from "react";

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../../../../components/ui/alert-dialog";
import { Button } from "../../../../components/ui/button";
import { ProblemList } from "../../Desk/ProblemList/ProblemList.tsx";

type Props = {
  /** The item's handle and title. */
  name: string;
  file: string;
  open: boolean;
  /** Delete can't be pressed (a delete on its way, or one refused as stale). */
  disabled: boolean;
  /** Why the last delete failed, shown in the dialog. */
  problems: readonly Problem[];
  onCancel: () => void;
  onDelete: () => void;
};

/** Asks once before an item's file is deleted (focus starts on Cancel). */
export const DeleteItemDialog = ({ name, file, open, disabled, problems, onCancel, onDelete }: Props) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
        <AlertDialogDescription>This deletes the item's file, {file}. This can't be undone.</AlertDialogDescription>
        <div role="alert">
          <ProblemList problems={problems} file={file} className="text-sm text-danger" />
        </div>
        <AlertDialogFooter>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={disabled} onClick={onDelete}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
