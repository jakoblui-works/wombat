// Where a notice (an agent waiting, or the service kept running at quit) leaves the app: Electron's Notification on a
// real run, the e2e recorder under the e2e checks (the hidden e2e app must not show real notifications). Notices are
// the app's own fixed texts (WAITING_NOTICE, keptNotice), never agent content. Kept apart from index.ts so what Electron is given can be
// checked against a fake class.
import type { ShownNotice } from "./waiting-notice.ts";

export type Notice = { readonly title: string; readonly body: string };

/** The part of Electron's Notification the sink uses. */
type NotificationLike = { on(event: "click" | "show" | "failed", listener: () => void): unknown; show(): void; close(): void };

/** A notice handed to the desktop; `shown` settles once the desktop has it (or refused it, or there's none to give). */
export type SentNotice = ShownNotice & { shown: Promise<void> };

export type NoticeSinkDeps = {
  /** Under the e2e checks: record the notice instead of showing it. */
  e2e: boolean;
  record: (notice: Notice) => void;
  /** Whether the desktop can show notifications at all. */
  isSupported: () => boolean;
  create: (options: { title: string; body: string }) => NotificationLike;
  /** Where a notice that can't be shown is reported (default stderr). */
  log?: (line: string) => void;
};

const NOTHING_SHOWN: SentNotice = { close: () => undefined, shown: Promise.resolve() };

// The notifier keeps the returned handle, and with it the Notification: one that's collected loses its click handler.
export const noticeSink =
  ({ e2e, record, isSupported, create, log = console.error }: NoticeSinkDeps) =>
  (notice: Notice, onClick?: () => void): SentNotice => {
    if (e2e) {
      record(notice);
      return NOTHING_SHOWN;
    }
    if (!isSupported()) {
      log(`This desktop can't show notifications, so Wombat couldn't show "${notice.body}".`);
      return NOTHING_SHOWN;
    }
    const shown = create({ title: notice.title, body: notice.body });
    if (onClick !== undefined) shown.on("click", onClick);
    const handed = new Promise<void>((resolve) => {
      shown.on("show", resolve);
      shown.on("failed", resolve);
    });
    shown.show();
    return { close: () => shown.close(), shown: handed };
  };
