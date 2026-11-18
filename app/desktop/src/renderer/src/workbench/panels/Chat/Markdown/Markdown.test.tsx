// Whatever an agent
// writes, the chat renders it as text. Raw HTML (scripts, frames, event handlers) shows as its own text; a link is an
// <a> only for an https: URL, and opens in a new window without a referrer; any other URL, in any link syntax, shows
// as its text with no href; an image never loads (no src anywhere) and shows its alt text.
// Rendered with react-dom/server: React escapes every `<` in text, so each `<` in the markup starts a real element.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { Markdown } from "./Markdown.tsx";

type Element = { tag: string; attrs: Map<string, string> };

const TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTR = /\s+([^\s=>/]+)(?:="([^"]*)")?/g;

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const render = (text: string): { html: string; elements: Element[]; visible: string } => {
  const html = renderToStaticMarkup(<Markdown text={text} />);
  const elements = [...html.matchAll(TAG)].map(([, tag = "", attrs = ""]) => ({
    tag: tag.toLowerCase(),
    attrs: new Map([...attrs.matchAll(ATTR)].map(([, name = "", value = ""]) => [name.toLowerCase(), decode(value)])),
  }));
  return { html, elements, visible: decode(html.replace(/<[^>]*>/g, "")) };
};

/** Elements that run, frame, load or style something; none may come out of agent text. */
const ACTIVE_TAGS = ["script", "iframe", "frame", "object", "embed", "img", "image", "video", "audio", "source", "style", "link", "meta", "base", "form", "svg", "math"];
/** Attributes that load or run something; `href` is checked on its own. */
const LOADING_ATTRS = ["src", "srcset", "srcdoc", "action", "formaction", "poster", "data", "background", "xlink:href"];

const expectInert = (text: string): ReturnType<typeof render> => {
  const out = render(text);
  for (const { tag, attrs } of out.elements) {
    expect(ACTIVE_TAGS, `<${tag}> rendered from ${JSON.stringify(text)}`).not.toContain(tag);
    for (const [name, value] of attrs) {
      expect(name.startsWith("on"), `${name} on <${tag}> from ${JSON.stringify(text)}`).toBe(false);
      expect(LOADING_ATTRS, `${name} on <${tag}> from ${JSON.stringify(text)}`).not.toContain(name);
      if (name === "style") expect(value, `style on <${tag}> from ${JSON.stringify(text)}`).not.toMatch(/url\(|expression\(/i);
      if (name === "href") expect(value, `href on <${tag}> from ${JSON.stringify(text)}`).toMatch(/^https:\/\//);
    }
    if (attrs.has("href")) expect(tag).toBe("a");
  }
  return out;
};

test("raw HTML shows as its own text: no element, handler or load comes from it", () => {
  const samples = [
    '<script>window.__wombatHostile = "script"</script>',
    '<img src="x" onerror="window.__wombatHostile = 1">',
    '<iframe src="https://example.invalid/frame"></iframe>',
    "<style>body { background: url(https://example.invalid/track.png) }</style>",
    '<a href="https://example.invalid/docs" onclick="window.__wombatHostile = 1">html link</a>',
    '<div onmouseover="window.__wombatHostile = 1">Hover me</div>',
    '<svg onload="window.__wombatHostile = 1"></svg>',
    "<form action=\"https://example.invalid/post\"><button>Send</button></form>",
    "Inline <span style=\"background:url(https://example.invalid/x.png)\">tag</span> in a sentence.",
    "```html\n<script>window.__wombatHostile = 1</script>\n```",
    "`<img src=x onerror=alert(1)>` as inline code",
  ];
  for (const sample of samples) {
    const { visible } = expectInert(sample);
    // The text is still there to read, markup and all.
    const words = sample.match(/<[a-z]+/g) ?? [];
    for (const word of words) expect(visible, `the text of ${JSON.stringify(sample)}`).toContain(word);
  }
});

test("an image never loads: it shows its alt text", () => {
  for (const sample of ["![a loaf of rye bread](https://example.invalid/bread.png)", "![oven photo][pic]\n\n[pic]: https://example.invalid/oven.png"]) {
    const { visible } = expectInert(sample);
    expect(visible).toContain(sample.includes("rye") ? "a loaf of rye bread" : "oven photo");
  }
});

// Every URL that isn't https:, written in every way markdown makes a link.
const NOT_HTTPS = [
  "javascript:window.__wombatHostile=1",
  "JaVaScRiPt:window.__wombatHostile=1",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "file:///etc/hostname",
  "app://wombat/index.html",
  "http://example.invalid/plain",
] as const;

const SYNTAXES = {
  inline: (url: string, label: string) => `[${label}](${url})`,
  inlineAngle: (url: string, label: string) => `[${label}](<${url}>)`,
  reference: (url: string, label: string) => `[${label}][ref]\n\n[ref]: ${url}`,
  autolink: (url: string, label: string) => `${label} <${url}>`,
  bare: (url: string, label: string) => `${label} ${url}`,
  html: (url: string, label: string) => `<a href="${url}">${label}</a>`,
} as const;

test("a link is an <a> only for https:, in every link syntax; any other URL shows as text with no href", () => {
  // Every pair, not a sample: the list is short and each pair is a different path through the parser.
  for (const url of NOT_HTTPS) {
    for (const syntax of Object.keys(SYNTAXES) as (keyof typeof SYNTAXES)[]) {
      const label = "Open the menu";
      const { elements, visible } = expectInert(SYNTAXES[syntax](url, label));
      expect(elements.filter(({ attrs }) => attrs.has("href")), `${syntax} ${url}`).toEqual([]);
      expect(visible, `${syntax} ${url}`).toContain(label);
    }
  }
  // GFM's bare www. links become http: links: text too.
  expect(expectInert("See www.example.invalid for hours").elements.filter(({ attrs }) => attrs.has("href"))).toEqual([]);
});

test("an https link is a link that opens in a new window without a referrer, in each markdown link syntax", () => {
  const url = "https://example.invalid/opening-hours";
  for (const syntax of ["inline", "inlineAngle", "reference", "autolink", "bare"] as const) {
    const { elements } = expectInert(SYNTAXES[syntax](url, "Opening hours"));
    const links = elements.filter(({ tag }) => tag === "a");
    expect(links, syntax).toHaveLength(1);
    const [link] = links;
    expect(link?.attrs.get("href"), syntax).toBe(url);
    expect(link?.attrs.get("target"), syntax).toBe("_blank");
    expect(link?.attrs.get("rel")?.split(/\s+/), syntax).toContain("noreferrer");
  }
});
