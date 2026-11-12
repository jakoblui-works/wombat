// Where a waiting notice leaves the app: Electron's Notification on a real run, the e2e recorder under the e2e checks
// (the hidden e2e app must not show real notifications). Kept apart from index.ts so what Electron is given can be
// checked against a fake class.
import type { ShownNotice, WAITING_NOTICE } from "./waiting-notice.ts";

/** The part of Electron's Notification the sink uses. */
type NotificationLike = { on(event: "click", listener: () => void): unknown; show(): void; close(): void };

export type NoticeSinkDeps = {
  /** Under the e2e checks: record the notice instead of showing it. */
  e2e: boolean;
  record: (notice: typeof WAITING_NOTICE) => void;
  /** Whether the desktop can show notifications at all. */
  isSupported: () => boolean;
  create: (options: { title: string; body: string }) => NotificationLike;
};

const NOTHING_SHOWN: ShownNotice = { close: () => undefined };

// The notifier keeps the returned handle, and with it the Notification: one that's collected loses its click handler.
export const noticeSink =
  ({ e2e, record, isSupported, create }: NoticeSinkDeps) =>
  (notice: typeof WAITING_NOTICE, onClick: () => void): ShownNotice => {
    if (e2e) {
      record(notice);
      return NOTHING_SHOWN;
    }
    if (!isSupported()) return NOTHING_SHOWN;
    const shown = create({ title: notice.title, body: notice.body });
    shown.on("click", onClick);
    shown.show();
    return { close: () => shown.close() };
  };
