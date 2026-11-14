import { ScrollArea } from "../../../../components/ui/scroll-area";
import { fieldLines } from "./field-lines.ts";

/** An item proposal's changed fields, read-only, one name and value per line. */
export const ItemProposal = ({ fields }: { fields: Readonly<Record<string, unknown>> }) => {
  const lines = fieldLines(fields);
  return (
    <ScrollArea className="min-h-0 flex-1">
      {lines.length === 0 ? (
        <p className="p-5 text-sm text-fg-tertiary">This proposal changes no field.</p>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 p-4 text-sm">
          {lines.map(({ name, value }) => (
            <div key={name} className="contents">
              <dt className="font-mono text-xs leading-5 text-fg-tertiary">{name}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-fg-primary">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </ScrollArea>
  );
};
