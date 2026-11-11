import { useEffect, useState } from "react";

import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { startAgentVars, useStartAgent } from "../../../data/commands.ts";
import { useHarnesses, useRepos } from "../../../data/hooks.ts";
import { useWorkbench } from "../../workbench-context.ts";

/** The folder the pick starts on: the one used last if it's still listed, else the workspace root. */
const defaultFolder = (paths: readonly string[], last: string | undefined): string | undefined =>
  last !== undefined && paths.includes(last) ? last : paths[0];

const NewAgentForm = ({ onDone }: { onDone: () => void }) => {
  const repos = useRepos();
  const harnesses = useHarnesses();
  const start = useStartAgent();
  const { openTab } = useWorkbench();
  const [last, setLast] = useState<{ read: boolean; folder?: string }>({ read: false });
  const [picked, setPicked] = useState<string>();
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<Error>();

  useEffect(() => {
    let live = true;
    window.wombat.settings.get().then(
      ({ lastAgentFolder }) => live && setLast({ read: true, ...(lastAgentFolder === undefined ? {} : { folder: lastAgentFolder }) }),
      () => live && setLast({ read: true }),
    );
    return () => {
      live = false;
    };
  }, []);

  const folders = repos.data?.repos ?? [];
  const folder = picked ?? (last.read ? defaultFolder(folders.map(({ path }) => path), last.folder) : undefined);
  const harness = harnesses.data?.[0]?.id;
  const ready = folder !== undefined && harness !== undefined && text.trim() !== "" && !start.isPending;

  const submit = async () => {
    if (folder === undefined || harness === undefined) return;
    setFailure(undefined);
    try {
      const agent = await start.mutateAsync(startAgentVars({ harness, repo: folder, text: text.trim() }));
      // The dialog's job is done once the agent runs; remembering the folder must not hold up opening its chat.
      await window.wombat.settings.set({ lastAgentFolder: folder }).catch(() => undefined);
      onDone();
      openTab("chat", { agentId: agent.id });
    } catch (error) {
      // Shown below; the dialog stays so the text isn't lost.
      setFailure(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const error = failure ?? repos.error ?? harnesses.error;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span id="new-agent-folder-label" className="text-sm font-medium text-fg-secondary">
          Folder
        </span>
        <Select
          value={folder ?? null}
          onValueChange={(value) => setPicked(value ?? undefined)}
          items={folders.map(({ path, name }) => ({ value: path, label: name }))}
        >
          <SelectTrigger aria-labelledby="new-agent-folder-label" disabled={folders.length === 0}>
            <SelectValue placeholder="Choose a folder" />
          </SelectTrigger>
          <SelectContent>
            {folders.map(({ path, name }) => (
              <SelectItem key={path} value={path}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-agent-message" className="text-sm font-medium text-fg-secondary">
          First message
        </label>
        <textarea
          id="new-agent-message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          placeholder="What should the agent do?"
          className="focus-ring resize-none rounded-md border border-line-strong bg-surface-1 px-2.5 py-2 text-base text-fg-primary placeholder:text-fg-tertiary"
        />
      </div>
      {error === null || error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error.message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Start
        </Button>
      </DialogFooter>
    </form>
  );
};

/** New agent: pick the folder, write the first message, Start. Open state is the caller's. */
export const NewAgentDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogTitle>New agent</DialogTitle>
      <DialogDescription>Pick where the agent works and tell it what to do.</DialogDescription>
      <NewAgentForm onDone={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>
);
