import type { ProposalVersion } from "@wombat/shared/proposals";

import { ago, useNow } from "../../../lib/ago";

const REASON_CHARS = 80;

/** One version as the picker lists it: "v2 · you · 4m", the agent's title for its own, then the reason (cut short) and whether it's current. */
export const versionEntry = (version: ProposalVersion, agentTitle: string, current: number, now: number): string => {
  const reason = version.reason.length > REASON_CHARS ? `${version.reason.slice(0, REASON_CHARS - 1)}…` : version.reason;
  return [`v${String(version.n)}`, version.by === "me" ? "you" : agentTitle, ago(version.at, now), version.n === current ? "current" : "", reason]
    .filter((part) => part !== "")
    .join(" · ");
};

/**
 * The proposal's versions, newest first; picking one shows it in the tab. A native select: the app's menu bar is made
 * of menu items, and a popup menu's entries would be found among them.
 */
export const VersionPicker = ({
  versions,
  current,
  shown,
  agentTitle,
  onPick,
}: {
  versions: readonly ProposalVersion[];
  current: number;
  shown: number;
  agentTitle: string;
  onPick: (version: number) => void;
}) => {
  const now = useNow();
  return (
    <select
      aria-label="Version"
      value={shown}
      onChange={(event) => onPick(Number(event.target.value))}
      className="focus-ring h-6 max-w-72 min-w-0 shrink truncate rounded-md border border-line-strong bg-surface-1 px-1.5 text-xs text-fg-secondary"
    >
      {versions.toReversed().map((version) => (
        <option key={version.n} value={version.n} title={version.reason}>
          {versionEntry(version, agentTitle, current, now)}
        </option>
      ))}
    </select>
  );
};
