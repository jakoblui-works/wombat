// The one place Monaco is set up: its ES modules (never the AMD loader), only the editor API, the
// diff editor and TypeScript/JavaScript highlighting. Its CSS imports build into the page's CSS
// file; the <style> elements it creates at runtime take the page's nonce, set below
// (patches/monaco-editor@*.patch), and its style="" line styles are allowed by style-src-attr
// (VS Code's own policy: Monaco draws its lines with style attributes).
import { setCspNonce } from "monaco-editor/base/browser/domStylesheets";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/typescript/register";
import { cspNonce } from "./csp-nonce.ts";

// Before anything creates an editor (Monaco makes its <style> elements then, not on import).
setCspNonce(cspNonce());

// Diffing and the other model work run in the editor worker (a same-origin file, so worker-src
// 'self' allows it). Highlighting is Monarch on the main thread, so no language worker is needed.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export * as monaco from "monaco-editor/editor";
