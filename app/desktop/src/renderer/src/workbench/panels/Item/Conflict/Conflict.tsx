import { Button } from "../../../../components/ui/button";

type Entry = { field: string; label: string; mine: string; theirs: string; long: boolean };

const Value = ({ heading, text, long }: { heading: string; text: string; long: boolean }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <span className="text-xs text-fg-tertiary">{heading}</span>{" "}
    {long ? (
      <pre className="max-h-64 overflow-auto rounded-md border border-line bg-surface-1 px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-fg-primary">{text}</pre>
    ) : (
      <span className="wrap-break-word whitespace-pre-wrap text-fg-primary">{text}</span>
    )}{" "}
  </div>
);

/** After a stale save: each changed field, mine against the file's now, with Take theirs; Keep mine saves the rest. */
export const Conflict = ({
  entries,
  keepable,
  onTakeTheirs,
  onKeepMine,
}: {
  entries: readonly Entry[];
  /** Whether Keep mine may save now (not while the tab can't show the item). */
  keepable: boolean;
  onTakeTheirs: (field: string) => void;
  onKeepMine: () => void;
}) => (
  <section role="alert" className="flex flex-col gap-3 rounded-md border border-state-waiting/40 bg-surface-2 px-3 py-2.5 text-sm">
    <p className="text-fg-secondary">The file was edited before your save reached it, so nothing was saved. Take the file's value where you want it, and Keep mine saves the rest on top of the file as it is now.</p>
    <ul className="flex flex-col gap-3">
      {entries.map(({ field, label, mine, theirs, long }) => (
        <li key={field} className="flex flex-col gap-2 border-t border-line pt-2">
          <span className="font-medium text-fg-primary">{label}</span>{" "}
          <div className="grid grid-cols-2 gap-3">
            <Value heading="Yours" text={mine} long={long} />{" "}
            <Value heading="In the file" text={theirs} long={long} />
          </div>{" "}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onTakeTheirs(field)}>
            Take theirs
          </Button>
        </li>
      ))}
    </ul>
    <Button type="button" variant="outline" className="self-start" disabled={!keepable} onClick={onKeepMine}>
      Keep mine
    </Button>
  </section>
);
