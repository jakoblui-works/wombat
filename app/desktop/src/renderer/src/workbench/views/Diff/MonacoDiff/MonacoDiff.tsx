// Monaco's diff editor, read-only and side by side. Loaded on demand by the diff tab (lib/monaco.ts pulls in Monaco),
// so the rest of the page, and the registry under node, never load it.
import { useEffect, useRef } from "react";

import { languageOf, MONACO_HOST_CLASS, MONACO_THEME, monaco } from "../../../../lib/monaco.ts";
import { cn } from "../../../../lib/utils";

type Props = { path: string; oldText: string; newText: string; className?: string | undefined };

export const MonacoDiff = ({ path, oldText, newText, className }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<ReturnType<typeof monaco.editor.createDiffEditor>>(undefined);

  useEffect(() => {
    if (host.current === null) return;
    const created = monaco.editor.createDiffEditor(host.current, {
      theme: MONACO_THEME,
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      // An edit's diff may be a snippet of the file, so numbers counted from 1 would mislead.
      lineNumbers: "off",
      // Agent text stays text: nothing in it is a link or opens a hover.
      links: false,
      hover: { enabled: "off" },
      fontSize: 12,
    });
    editor.current = created;
    return () => {
      created.dispose();
      editor.current = undefined;
    };
  }, []);

  // The texts' models, replaced when the texts change and disposed with them (an editor's dispose leaves its models).
  useEffect(() => {
    const current = editor.current;
    if (current === undefined) return;
    const language = languageOf(path);
    const original = monaco.editor.createModel(oldText, language);
    const modified = monaco.editor.createModel(newText, language);
    current.setModel({ original, modified });
    return () => {
      // Detached first: the editor would otherwise render disposed models.
      if (editor.current === current) current.setModel(null);
      original.dispose();
      modified.dispose();
    };
  }, [path, oldText, newText]);

  return <div ref={host} className={cn(MONACO_HOST_CLASS, className)} />;
};
