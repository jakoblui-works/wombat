import { EmptyState } from "../EmptyState/EmptyState.tsx";
import { SidebarHeader } from "../SidebarHeader/SidebarHeader.tsx";

/** The Files activity's sidebar until it's built. */
export const EmptyFiles = () => (
  <div className="flex h-full min-h-0 flex-col">
    <SidebarHeader title="Files" />
    <div className="min-h-0 flex-1">
      <EmptyState symbol title="Files arrive in step 9" body="Browse and edit the workspace's files here." />
    </div>
  </div>
);
