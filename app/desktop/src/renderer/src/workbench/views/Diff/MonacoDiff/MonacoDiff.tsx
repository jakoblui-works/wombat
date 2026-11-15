// Monaco's diff editor, side by side, read-only unless given `edit`. Loaded on demand by the diff tab (lib/monaco.ts pulls in Monaco),
// so the rest of the page, and the registry under node, never load it.
import { useEffect, useRef } from "react";

import { languageOf, MONACO_HOST_CLASS, MONACO_THEME, monaco } from "../../../../lib/monaco.ts";
import { cn } from "../../../../lib/utils";
import { asEditorText } from "../../Proposal/line-endings.ts";

type Props = {
  path: string;
  oldText: string;
  newText: string;
  className?: string | undefined;
  /** On for a whole file (the proposal tab), off for an edit request's snippet, whose numbers counted from 1 would mislead. */
  lineNumbers?: boolean | undefined;
  /**
   * Makes the right side editable, with the gutter's arrows that drop a hunk. Every change, typed or dropped, calls
   * `onChange` with the whole right-side text (in the model's line endings, without a leading byte order mark). The editor keeps its own text: a
   * `newText` it reported through `onChange`, or with the lines it holds, leaves it; only a new `path` or another
   * `newText` replaces it. A new `oldText` changes only the left side.
   */
  edit?: { onChange: (text: string) => void } | undefined;
};

type Models = {
  path: string;
  left: ReturnType<typeof monaco.editor.createModel>;
  right: ReturnType<typeof monaco.editor.createModel>;
  changes: { dispose: () => void };
  /** Texts reported through `onChange` that no `newText` has carried back yet, oldest first. */
  reported: string[];
};

const editOptions = (editable: boolean) =>
  ({ readOnly: !editable, renderMarginRevertIcon: editable, renderGutterMenu: editable, renderLineHighlight: editable ? "line" : "none" }) as const;

const dropModels = (diff: ReturnType<typeof monaco.editor.createDiffEditor>, held: Models | undefined): void => {
  if (held === undefined) return;
  held.changes.dispose();
  // Detached first: the editor would otherwise render disposed models.
  diff.setModel(null);
  held.left.dispose();
  held.right.dispose();
};

export const MonacoDiff = ({ path, oldText, newText, className, lineNumbers = false, edit }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<ReturnType<typeof monaco.editor.createDiffEditor>>(undefined);
  // An editor's dispose leaves its models.
  const models = useRef<Models>(undefined);
  const oldTextNow = useRef(oldText);
  oldTextNow.current = oldText;
  const onChange = useRef(edit?.onChange);
  onChange.current = edit?.onChange;
  const editable = edit !== undefined;

  useEffect(() => {
    if (host.current === null) return;
    const created = monaco.editor.createDiffEditor(host.current, {
      theme: MONACO_THEME,
      automaticLayout: true,
      ...editOptions(editable),
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      // Read once: the editor is made once per mount.
      lineNumbers: lineNumbers ? "on" : "off",
      // Agent text stays text: nothing in it is a link or opens a hover.
      links: false,
      hover: { enabled: "off" },
      fontSize: 12,
    });
    editor.current = created;
    return () => {
      dropModels(created, models.current);
      models.current = undefined;
      created.dispose();
      editor.current = undefined;
    };
  }, []);

  useEffect(() => {
    editor.current?.updateOptions(editOptions(editable));
  }, [editable]);

  // Re-created on a new left side, or on text the editor already held, the right side would lose its cursor and undo.
  // `newText` may follow the reports a few keystrokes behind the model: what it carries back is never new.
  useEffect(() => {
    const current = editor.current;
    if (current === undefined) return;
    const held = models.current;
    if (held?.path === path) {
      const reported = held.reported.lastIndexOf(newText);
      if (reported >= 0) {
        held.reported.splice(0, reported + 1);
        return;
      }
      if (held.right.getValue(monaco.editor.EndOfLinePreference.LF) === asEditorText(newText)) return;
    }
    dropModels(current, held);
    const language = languageOf(path);
    const left = monaco.editor.createModel(oldTextNow.current, language);
    const right = monaco.editor.createModel(newText, language);
    current.setModel({ original: left, modified: right });
    const reported: string[] = [];
    const changes = right.onDidChangeContent(() => {
      if (onChange.current === undefined) return;
      const text = right.getValue();
      reported.push(text);
      onChange.current(text);
    });
    models.current = { path, left, right, changes, reported };
  }, [path, newText]);

  useEffect(() => {
    const left = models.current?.left;
    if (left !== undefined && left.getValue() !== oldText) left.setValue(oldText);
  }, [oldText]);

  return <div ref={host} className={cn(MONACO_HOST_CLASS, className)} />;
};
