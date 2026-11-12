import { EmptyState } from "../views/EmptyState/EmptyState.tsx";

/** Dockview's watermark: what an editor group without a tab shows. */
export const EmptyGroup = () => <EmptyState title="No tab open" body="Open an agent from the list, or drag a tab here." />;
