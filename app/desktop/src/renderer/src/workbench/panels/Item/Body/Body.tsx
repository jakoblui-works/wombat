import type { Problem } from "@wombat/shared/items";
import { useState } from "react";

import { Markdown } from "../../../../components/Markdown/Markdown.tsx";
import { Button } from "../../../../components/ui/button";
import { ProblemList } from "../../Desk/ProblemList/ProblemList.tsx";
import { LazyMarkdownEditor } from "./MarkdownEditor/LazyMarkdownEditor.tsx";

type Props = {
  /** The item's file, for the editor's model and the problems' lines. */
  path: string;
  file: string;
  text: string;
  onChange: (text: string) => void;
  problems: readonly Problem[];
};

/** An item's body, rendered, or raw in the Markdown editor after Edit. */
export const Body = ({ path, file, text, onChange, problems }: Props) => {
  const [editing, setEditing] = useState(false);
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-fg-tertiary">Body</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing((now) => !now)}>
          {editing ? "Done" : "Edit"}
        </Button>
      </div>
      {editing ? (
        <LazyMarkdownEditor path={path} text={text} onChange={onChange} />
      ) : text.trim() === "" ? (
        <p className="text-sm text-fg-tertiary">No body</p>
      ) : (
        <Markdown text={text} className="text-base text-fg-primary" />
      )}
      <ProblemList problems={problems} file={file} className="text-sm text-danger" />
    </section>
  );
};
