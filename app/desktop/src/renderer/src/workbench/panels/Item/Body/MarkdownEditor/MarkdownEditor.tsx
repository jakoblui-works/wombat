// An item's body as Markdown in Monaco. Loaded on demand (lib/monaco.ts pulls in Monaco), so the page and the
// registry under node never load it.
import { useEffect, useRef } from "react";

import { asEditorText } from "../../../../../lib/editor-text.ts";
import { MONACO_HOST_CLASS, MONACO_THEME, monaco } from "../../../../../lib/monaco.ts";

type Props = {
  /** The item's file; a new path starts a new model. */
  path: string;
  text: string;
  /** Every change, with the whole text. */
  onChange: (text: string) => void;
};

const MIN_HEIGHT = 160;

/**
 * The editor keeps its own text: a `text` it reported through `onChange` (carried back a few keystrokes behind), or
 * one it already holds, leaves it; any other `text` (Take theirs, Discard, a save) replaces it as one undoable edit.
 */
export const MarkdownEditor = ({ path, text, onChange }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<ReturnType<typeof monaco.editor.create>>(undefined);
  const reported = useRef<string[]>([]);
  const applying = useRef(false);
  const report = useRef(onChange);
  report.current = onChange;
  const textNow = useRef(text);
  textNow.current = text;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const model = monaco.editor.createModel(textNow.current, "markdown");
    const created = monaco.editor.create(element, {
      model,
      theme: MONACO_THEME,
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: "on",
      lineNumbers: "off",
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      scrollbar: { alwaysConsumeMouseWheel: false },
      fontSize: 13,
    });
    editor.current = created;
    reported.current = [];
    const changes = model.onDidChangeContent(() => {
      if (applying.current) return;
      const value = model.getValue();
      reported.current.push(value);
      report.current(value);
    });
    // As tall as its text, so the tab scrolls rather than the editor.
    const fit = () => {
      element.style.height = `${String(Math.max(MIN_HEIGHT, created.getContentHeight()))}px`;
    };
    const sizes = created.onDidContentSizeChange(fit);
    fit();
    return () => {
      changes.dispose();
      sizes.dispose();
      created.dispose();
      model.dispose();
      editor.current = undefined;
    };
  }, [path]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (model === null || model === undefined) return;
    const at = reported.current.lastIndexOf(text);
    if (at >= 0) {
      reported.current.splice(0, at + 1);
      return;
    }
    if (model.getValue(monaco.editor.EndOfLinePreference.LF) === asEditorText(text)) return;
    reported.current = [];
    applying.current = true;
    try {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
    } finally {
      applying.current = false;
    }
  }, [text]);

  return <div ref={host} className={`${MONACO_HOST_CLASS} overflow-hidden rounded-md border border-line`} />;
};
