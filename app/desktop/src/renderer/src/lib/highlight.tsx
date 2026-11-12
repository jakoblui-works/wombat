import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, type JSX } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import nix from "shiki/langs/nix.mjs";
import python from "shiki/langs/python.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";

// Only the languages and theme the app uses are bundled; add a language here to highlight it (its aliases, such as
// "ts", "bash" or "sh", come with it). The JavaScript regex engine keeps Shiki off WebAssembly, which the page's CSP
// doesn't allow.
const LANGS = { typescript, tsx, javascript, json, shellscript, python, yaml, markdown, diff, nix, css, html, sql } as const;
// The theme itself, not its name typed again: Shiki finds a loaded theme by the name it carries.
const THEME = githubDarkDefault;

export type CodeLang = keyof typeof LANGS;

/** Shiki's built-in plain text: no grammar, no colours beyond the theme's foreground. */
const PLAIN = "text";

const highlighter = createHighlighterCoreSync({
  themes: [THEME],
  langs: Object.values(LANGS),
  engine: createJavaScriptRegexEngine(),
});

const loaded = new Set(highlighter.getLoadedLanguages());

/** The language to highlight `lang` as: a bundled language or one of its aliases ("ts"), else plain text. */
const knownLang = (lang: string | undefined): string => (lang !== undefined && loaded.has(lang.toLowerCase()) ? lang.toLowerCase() : PLAIN);

// Code as React elements: token colours become style props (set through CSSOM), never a
// style="" string or raw HTML, since the code shown may be agent content.
// (The cast: hast-util-to-jsx-runtime types its result as the global `JSX.Element`, which React
// 19's types no longer declare.)
// A language that isn't bundled (or none) shows as plain text.
export const Code = ({ code, lang }: { code: string; lang?: string | undefined }): JSX.Element =>
  toJsxRuntime(highlighter.codeToHast(code, { lang: knownLang(lang), theme: THEME }), { Fragment, jsx, jsxs }) as JSX.Element;
