// The one place Monaco is set up: its ES modules (never the AMD loader), only the editor API, the
// diff editor and Monarch highlighting for the languages registered below. Its CSS imports build into the page's CSS
// file; the <style> elements it creates at runtime take the page's nonce, set below
// (patches/monaco-editor@*.patch), and its style="" line styles are allowed by style-src-attr
// (VS Code's own policy: Monaco draws its lines with style attributes).
import { setCspNonce } from "monaco-editor/base/browser/domStylesheets";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/yaml/register";
import { cspNonce } from "./csp-nonce.ts";

// Before anything creates an editor (Monaco makes its <style> elements then, not on import).
setCspNonce(cspNonce());

// Diffing and the other model work run in the editor worker (a same-origin file, so worker-src
// 'self' allows it). Highlighting is Monarch on the main thread, so no language worker is needed.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/**
 * The theme every editor uses: Monaco's dark one for syntax colours, with its surfaces, line numbers and diff lines
 * mapped onto Wombat's tokens by styles/monaco-theme.css (under the `monaco-wombat` class on the editor's host).
 */
export const MONACO_THEME = "vs-dark";
export const MONACO_HOST_CLASS = "monaco-wombat";

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  // Monaco's JSON is a language service with a worker of its own; JavaScript's Monarch grammar colours JSON's
  // strings, numbers and literals on the main thread.
  json: "javascript",
  jsonc: "javascript",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  css: "css",
};

/** The highlighting a file gets, by its extension: one of the languages registered above, else plain text. */
export const languageOf = (path: string): string => LANGUAGES[/\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""] ?? "plaintext";

export * as monaco from "monaco-editor/editor";
