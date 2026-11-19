import { ProblemList } from "../../Desk/ProblemList/ProblemList.tsx";
import type { LinkTarget, PropertyRow } from "./property-rows.ts";

const Link = ({ link, text, onOpenItem }: { link: LinkTarget; text: string; onOpenItem: (binderId: string, itemId: string) => void }) =>
  link.found ? (
    <button
      type="button"
      onClick={() => onOpenItem(link.binderId, link.itemId)}
      className="focus-ring inline-flex max-w-full items-baseline gap-1.5 rounded-xs text-left text-fg-primary underline decoration-line-strong underline-offset-2 hover:decoration-fg-secondary"
    >
      <span className="shrink-0 font-mono text-xs text-fg-secondary">{link.handle}</span>
      {link.title === undefined ? null : <span className="min-w-0 break-words">{link.title}</span>}
    </button>
  ) : (
    <span className="text-fg-tertiary">{text}</span>
  );

/** The item's properties as a description list, one entry per row, its problems under its value. */
export const Fields = ({ rows, file, onOpenItem }: { rows: readonly PropertyRow[]; file: string; onOpenItem: (binderId: string, itemId: string) => void }) => (
  <dl className="grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-6 gap-y-2 text-sm">
    {rows.map(({ name, text, link, problems }) => (
      <div key={name} className="contents">
        <dt className="py-0.5 text-fg-tertiary">{name}</dt>
        <dd className="flex min-w-0 flex-col gap-1 py-0.5">
          {link !== undefined ? (
            <Link link={link} text={text} onOpenItem={onOpenItem} />
          ) : text === "" ? (
            <span className="text-fg-tertiary">none</span>
          ) : (
            <span className="whitespace-pre-wrap break-words text-fg-primary">{text}</span>
          )}
          <ProblemList problems={problems} file={file} className="text-sm text-danger" />
        </dd>
      </div>
    ))}
  </dl>
);
