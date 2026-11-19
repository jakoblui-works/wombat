import { useRef } from "react";

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../../../../components/ui/alert-dialog";
import { Button } from "../../../../components/ui/button";

type Props = {
  /** The item's handle and title. */
  name: string;
  file: string;
  open: boolean;
  pending: boolean;
  /** Why the last delete failed, shown in the dialog. */
  error: string | undefined;
  onCancel: () => void;
  onDelete: () => void;
};

/** Asks once before an item's file is deleted (focus starts on Cancel). */
export const DeleteItemDialog = ({ name, file, open, pending, error, onCancel, onDelete }: Props) => {
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
        {error === undefined ? null : (
          <p role="alert" className="text-sm whitespace-pre-line text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onDelete}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
