import type { ComponentProps } from "react";

import type { FileProposalKind } from "@wombat/shared/proposals";
import { fileSide } from "../../../proposals/proposal-label.ts";
import { LazyMonacoDiff } from "../../Diff/MonacoDiff/LazyMonacoDiff.tsx";

/**
 * A file proposal's diff, the whole file with line numbers: the file as it is now on the left (empty for a new file),
 * the proposed text on the right, editable when given `edit`.
 */
export const FileProposal = ({
  path,
  kind,
  current,
  text,
  edit,
}: {
  path: string;
  kind: FileProposalKind;
  current: string | null;
  text: string;
  edit?: ComponentProps<typeof LazyMonacoDiff>["edit"];
}) => <LazyMonacoDiff path={path} oldText={fileSide({ kind, current })} newText={text} lineNumbers edit={edit} className="min-h-0 flex-1" />;
