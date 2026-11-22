import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { EmptyState } from "../EmptyState/EmptyState.tsx";

/** The sidebar of an activity that isn't built yet: its title row and its empty state, with the symbol. */
export const EmptyActivity = ({ title, body, heading }: { title: string; body: string; heading: string }) => (
  <div className="flex h-full min-h-0 flex-col">
    <SidebarHeader title={heading} />
    <div className="flex min-h-0 flex-1 flex-col justify-center-safe overflow-y-auto overscroll-y-contain">
      <div>
        <EmptyState symbol title={title} body={body} />
      </div>
    </div>
  </div>
);
