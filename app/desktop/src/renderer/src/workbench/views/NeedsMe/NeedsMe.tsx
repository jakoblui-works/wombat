import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";

/** The right sidebar's view: the requests waiting on the user. Only its frame for now. */
export const NeedsMe = () => (
  <div className="flex h-full min-h-0 flex-col">
    <SidebarHeader title="Needs me" />
  </div>
);
