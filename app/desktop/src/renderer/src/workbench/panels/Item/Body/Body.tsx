import { Markdown } from "../../../../components/Markdown/Markdown.tsx";

/** An item's body, rendered; nothing for an item without one. */
export const Body = ({ text }: { text: string | null }) =>
  text === null || text.trim() === "" ? null : <Markdown text={text} className="border-t border-line pt-5 text-base text-fg-primary" />;
