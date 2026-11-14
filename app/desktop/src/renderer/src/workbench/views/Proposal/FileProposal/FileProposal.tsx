import type { FileProposalKind } from "@wombat/shared/proposals";

import { LazyMonacoDiff } from "../../Diff/MonacoDiff/LazyMonacoDiff.tsx";

/**
 * A file proposal's diff, read-only, the whole file with line numbers: the file as it is now on the left (empty for a
 * new file), the proposed text on the right.
 */
export const FileProposal = ({ path, kind, current, text }: { path: string; kind: FileProposalKind; current: string | null; text: string }) => (
  <LazyMonacoDiff path={path} oldText={kind === "create" ? "" : (current ?? "")} newText={text} lineNumbers className="min-h-0 flex-1" />
);
