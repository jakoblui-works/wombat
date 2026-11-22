import { memo } from "react";

import { Markdown, type MarkdownProps } from "../../../../components/Markdown/Markdown.tsx";
import { Omitted, useClipped } from "../Omitted/Omitted.tsx";

/** A chat text as Markdown, clipped before it's parsed when it's longer than MAX_SHOWN_CHARS, with Show all. */
export const ClippedMarkdown = memo(({ text, className }: Pick<MarkdownProps, "text" | "className">) => {
  const { shown, omitted, showAll, textRef } = useClipped<HTMLDivElement>(text);
  return (
    <Markdown ref={textRef} text={shown} className={className}>
      <Omitted count={omitted} onShowAll={showAll} />
    </Markdown>
  );
});
ClippedMarkdown.displayName = "ClippedMarkdown";
