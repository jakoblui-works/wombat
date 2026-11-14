import { X } from "lucide-react";

import { useProposal } from "../../../../data/hooks.ts";
import { PathText } from "../../Proposal/PathText.tsx";
import { proposalLabel } from "../../Proposal/proposal-label.ts";

/** The proposal a message is about, above the message box, with a button that drops it. */
export const ReferenceChip = ({ proposalId, onRemove }: { proposalId: string; onRemove: () => void }) => {
  const read = useProposal(proposalId);
  const label = read.data === undefined ? proposalId : proposalLabel(read.data);
  return (
    <div className="mx-auto mb-1.5 flex max-w-chat items-center gap-1.5 text-sm text-fg-secondary">
      <span className="shrink-0">About</span>
      <span className="flex min-w-0 items-center gap-1 rounded-md border border-line bg-surface-2 py-0.5 pr-0.5 pl-2">
        <PathText path={label} className="font-mono text-xs text-fg-primary" />
        <button type="button" aria-label={`Remove the reference to ${label}`} onClick={onRemove} className="focus-ring shrink-0 rounded-sm p-0.5 text-fg-tertiary hover:text-fg-primary">
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  );
};
