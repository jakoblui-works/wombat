import { WombatSymbol } from "../WombatSymbol/WombatSymbol.tsx";

/**
 * A quiet, centred empty state: one line saying what's (not) here and one line of explanation. The symbol only where
 * the empty state stands for a whole activity, so a screen shows it at most once besides the title bar.
 */
export const EmptyState = ({ title, body, symbol = false }: { title: string; body: string; symbol?: boolean }) => (
  <div className="flex h-full items-center justify-center p-4">
    <div className="flex max-w-empty-state flex-col items-center text-center">
      {symbol ? <WombatSymbol className="mb-4 size-9" /> : null}
      <p className="text-base font-medium text-fg-primary">{title}</p>
      <p className="mt-1 text-sm text-fg-tertiary">{body}</p>
    </div>
  </div>
);
