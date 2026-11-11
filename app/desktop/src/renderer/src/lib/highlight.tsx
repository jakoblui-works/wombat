import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, type JSX } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import typescript from "shiki/langs/typescript.mjs";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";

// Only the languages and theme the app uses are bundled; add a language here to highlight it.
// The JavaScript regex engine keeps Shiki off WebAssembly, which the page's CSP doesn't allow.
const LANGS = { typescript } as const;
const THEME = "github-dark-default";

export type CodeLang = keyof typeof LANGS;

const highlighter = createHighlighterCoreSync({
  themes: [githubDarkDefault],
  langs: Object.values(LANGS),
  engine: createJavaScriptRegexEngine(),
});

// Code as React elements: token colours become style props (set through CSSOM), never a
// style="" attribute or raw HTML, so the page's CSP (style-src-attr 'none') allows them.
// (The cast: hast-util-to-jsx-runtime types its result as the global `JSX.Element`, which React
// 19's types no longer declare.)
export const Code = ({ code, lang }: { code: string; lang: CodeLang }): JSX.Element =>
  toJsxRuntime(highlighter.codeToHast(code, { lang, theme: THEME }), { Fragment, jsx, jsxs }) as JSX.Element;
