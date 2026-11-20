// What user, agent and item text may render as: the one place that decides. Agent text and item files are
// untrusted, so nothing in them may run, load or navigate in the page:
// - raw HTML shows as its own text (no rehype-raw; react-markdown turns raw nodes into text);
// - a link is an <a> only for an https: URL, opened in a new window without a referrer; any other URL shows as text;
// - an image never loads: it shows as its alt text;
// - code blocks go through `Code` (lib/highlight.tsx), which never writes raw HTML or style strings.
// The inline form keeps only code spans, emphasis and strikethrough: links show as their text, images are dropped.
import { memo, type ReactNode, type Ref, useId } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Code } from "../../lib/highlight.tsx";
import { cn } from "../../lib/utils.ts";

export type MarkdownProps = {
  text: string;
  className?: string | undefined;
  ref?: Ref<HTMLDivElement>;
  /** Shown under the text, inside the same element (the chat's line about a clipped text). */
  children?: ReactNode;
};

type Element = NonNullable<ExtraProps["node"]>;
type ElementContent = Element["children"][number];

/** The URL as a link target when it's an absolute https: URL, else undefined (it shows as text). */
export const httpsUrl = (url: string | undefined): string | undefined => {
  if (url === undefined || !/^https:\/\//i.test(url.trim())) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
};

/** Every text inside a hast node, in order. */
const textOf = (node: ElementContent | Element): string =>
  node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";

/** The fence's language (`language-ts` → `ts`). */
const fenceLang = (code: Element | undefined): string | undefined => {
  const classes: unknown = code?.properties["className"];
  const list: string[] = Array.isArray(classes) ? classes.map(String) : typeof classes === "string" ? classes.split(/\s+/) : [];
  return list.find((name) => name.startsWith("language-"))?.slice("language-".length);
};

/** A highlighted block, worked out again only when its code or language changes. */
const CodeBlock = memo(({ code, lang }: { code: string; lang: string | undefined }) => (
  <div className="code-block overflow-hidden rounded-md border border-line-subtle bg-surface-0">
    <Code code={code} lang={lang} />
  </div>
));
CodeBlock.displayName = "CodeBlock";

const InlineCode = ({ children }: { children?: ReactNode }) => <code className="rounded-xs bg-surface-3 px-1 py-px font-mono text-sm text-fg-primary">{children}</code>;

const COMPONENTS: Components = {
  a: ({ href, children }) => {
    const url = httpsUrl(href);
    return url === undefined ? (
      <span>{children}</span>
    ) : (
      <a href={url} target="_blank" rel="noreferrer" className="text-fg-primary underline decoration-line-strong underline-offset-2 hover:decoration-fg-secondary">
        {children}
      </a>
    );
  },
  img: ({ alt }) => <span className="text-fg-secondary italic">{alt}</span>,
  pre: ({ node }) => {
    const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
    // The fence's text ends with the newline before the closing fence; the block doesn't show it.
    const text = (code === undefined ? "" : textOf(code)).replace(/\n$/, "");
    return <CodeBlock code={text} lang={fenceLang(code)} />;
  },
  code: ({ children }) => <InlineCode>{children}</InlineCode>,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children, className }) => <ul className={cn("flex list-disc flex-col pl-5 marker:text-fg-tertiary", className === "contains-task-list" && "list-none pl-1")}>{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="flex list-decimal flex-col pl-5 marker:text-fg-tertiary">
      {children}
    </ol>
  ),
  h1: ({ children }) => <h3 className="text-lg font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="text-base font-semibold">{children}</h4>,
  h4: ({ children }) => <h5 className="text-base font-medium">{children}</h5>,
  h5: ({ children }) => <h6 className="text-base font-medium">{children}</h6>,
  h6: ({ children }) => <h6 className="text-base font-medium text-fg-secondary">{children}</h6>,
  blockquote: ({ children }) => <blockquote className="flex flex-col gap-2 border-l-2 border-line-strong pl-3 text-fg-secondary">{children}</blockquote>,
  hr: () => <hr className="border-line" />,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
};

const INLINE_ELEMENTS = ["code", "em", "strong", "del"];
/** The micromark constructs that start a block; the inline form reads them as text, so a title keeps its "1." or "#". */
const BLOCK_CONSTRUCTS = [
  "blockQuote",
  "codeFenced",
  "codeIndented",
  "definition",
  "gfmFootnoteDefinition",
  "headingAtx",
  "htmlFlow",
  "list",
  "setextUnderline",
  "table",
  "thematicBreak",
];
type ParserData = { micromarkExtensions?: { disable?: { null?: string[] } }[] };
// The parser reads its micromark extensions from the processor's data, which unified's own types don't declare.
const inlineOnly = function (this: { data: () => object }) {
  const data: ParserData = this.data();
  (data.micromarkExtensions ??= []).push({ disable: { null: BLOCK_CONSTRUCTS } });
};
const INLINE_COMPONENTS: Components = { code: ({ children }) => <InlineCode>{children}</InlineCode> };

const Rendered = memo(({ text, inline = false }: { text: string; inline?: boolean }) => {
  const id = useId();
  return (
    <ReactMarkdown
      remarkPlugins={inline ? [remarkGfm, inlineOnly] : [remarkGfm]}
      remarkRehypeOptions={{ clobberPrefix: `md${id.replace(/[^\w-]/g, "")}-` }}
      components={inline ? INLINE_COMPONENTS : COMPONENTS}
      allowedElements={inline ? INLINE_ELEMENTS : undefined}
      unwrapDisallowed={inline}
      skipHtml={false}
      urlTransform={(url) => httpsUrl(url) ?? ""}
    >
      {text}
    </ReactMarkdown>
  );
});
Rendered.displayName = "Rendered";

/** User, agent or item text as Markdown, inert: see the rules at the top of this file. */
export const Markdown = memo(({ text, className, ref, children }: MarkdownProps) => (
  <div ref={ref} tabIndex={-1} className={cn("flex min-w-0 flex-col gap-2 break-words outline-none", className)}>
    <Rendered text={text} />
    {children}
  </div>
));
Markdown.displayName = "Markdown";

/** One line of item text (a title) as inline Markdown inside a span: no blocks, links or images. */
export const InlineMarkdown = memo(({ text, className, id }: { text: string; className?: string | undefined; id?: string | undefined }) => (
  <span id={id} className={cn("min-w-0 break-words", className)}>
    <Rendered text={text} inline />
  </span>
));
InlineMarkdown.displayName = "InlineMarkdown";
