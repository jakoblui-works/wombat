// The diff editor as the tabs use it: Monaco loads with the first diff shown, not with the page.
import { type ComponentProps, lazy, Suspense } from "react";

import { Note } from "../../../approvals/Note/Note.tsx";

const MonacoDiff = lazy(() => import("./MonacoDiff.tsx").then(({ MonacoDiff: component }) => ({ default: component })));

export const LazyMonacoDiff = (props: ComponentProps<typeof MonacoDiff>) => (
  <Suspense fallback={<Note>Loading the diff…</Note>}>
    <MonacoDiff {...props} />
  </Suspense>
);
