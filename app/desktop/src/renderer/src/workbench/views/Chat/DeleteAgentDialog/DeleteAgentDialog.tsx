import { useRef, useState } from "react";

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../../../../components/ui/alert-dialog";
import { Button } from "../../../../components/ui/button";
import type { useAgentActions } from "../../AgentsList/agent-actions.ts";

type Props = {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: Pick<ReturnType<typeof useAgentActions>, "remove" | "pending">;
};

/** Confirms deleting an agent (focus starts on Cancel); confirmed, deletes it and closes, or shows why it failed. */
export const DeleteAgentDialog = ({ title, open, onOpenChange, actions }: Props) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string>();

  const confirm = () => {
    setError(undefined);
    actions.remove().then(
      () => onOpenChange(false),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
        <AlertDialogDescription>This stops the agent if it's running and removes it and its history. This can't be undone.</AlertDialogDescription>
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={actions.pending} onClick={confirm}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
