import { getActivity } from "../../workbench/registry.ts";
import { EmptyState } from "../../workbench/views/EmptyState/EmptyState.tsx";
import { SidebarHeader } from "../SidebarHeader/SidebarHeader.tsx";

/** The Files activity's sidebar until it's built: its registered empty state, with the symbol. */
export const EmptyFiles = () => {
  const files = getActivity("files");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarHeader title={files?.title ?? "Files"} />
      <div className="min-h-0 flex-1">{files?.emptyState ? <EmptyState symbol {...files.emptyState} /> : null}</div>
    </div>
  );
};
