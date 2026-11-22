// The body editor as the item tab uses it: Monaco loads with the first edit of a body, not with the page.
import { type ComponentProps, lazy, Suspense } from "react";

import { Note } from "../../../../approvals/Note/Note.tsx";

const MarkdownEditor = lazy(() => import("./MarkdownEditor.tsx").then(({ MarkdownEditor: component }) => ({ default: component })));

export const LazyMarkdownEditor = (props: ComponentProps<typeof MarkdownEditor>) => (
  <Suspense fallback={<Note>Loading the editor…</Note>}>
    <MarkdownEditor {...props} />
  </Suspense>
);
