// The one place a waiting notice leaves the app: Electron's Notification on a real run, the e2e recorder under
// WOMBAT_E2E=1. The desktop shows a notification outside the app and may keep it in a history, so what it is given must
// be the fixed WAITING_NOTICE and nothing else. Electron's class is replaced by a fake that keeps what it was given.
import { expect, test } from "vitest";

import { noticeSink } from "./notice-sink.ts";
import { WAITING_NOTICE } from "./waiting-notice.ts";

type Fake = { options: unknown; clickListeners: (() => void)[]; shown: number; closed: number };

/** A sink over a fake Notification class and recorder; keeps everything the sink hands them. */
const sinkWith = ({ e2e = false, supported = true } = {}) => {
  const created: Fake[] = [];
  const recorded: unknown[] = [];
  const show = noticeSink({
    e2e,
    record: (notice) => recorded.push(notice),
    isSupported: () => supported,
    create: (options) => {
      const fake: Fake = { options, clickListeners: [], shown: 0, closed: 0 };
      created.push(fake);
      return {
        on: (_event, listener) => fake.clickListeners.push(listener),
        show: () => {
          fake.shown += 1;
        },
        close: () => {
          fake.closed += 1;
        },
      };
    },
  });
  return { show, created, recorded };
};

test.each([
  ["a real run: the Notification", false],
  ["an e2e run: the recorder", true],
])("what reaches %s is exactly WAITING_NOTICE", (_name, e2e) => {
  const { show, created, recorded } = sinkWith({ e2e });
  show(WAITING_NOTICE, () => undefined);

  const received = e2e ? recorded : created.map(({ options }) => options);
  expect(received).toEqual([{ title: WAITING_NOTICE.title, body: WAITING_NOTICE.body }]);
  expect(e2e ? created : recorded, "both the Notification and the recorder were given the notice").toEqual([]);
});

test("the notification is shown; a click on it runs onClick, and the handle's close closes it", () => {
  const { show, created } = sinkWith();
  let clicks = 0;
  const handle = show(WAITING_NOTICE, () => {
    clicks += 1;
  });
  const [notification] = created;
  if (notification === undefined) throw new Error("no notification was created");
  expect(notification.shown).toBe(1);

  expect(clicks).toBe(0);
  for (const listener of notification.clickListeners) listener();
  expect(clicks).toBe(1);

  expect(notification.closed).toBe(0);
  handle.close();
  expect(notification.closed).toBe(1);
});

test("where notifications aren't supported nothing is created, and the handle's close is harmless", () => {
  const { show, created } = sinkWith({ supported: false });
  const handle = show(WAITING_NOTICE, () => undefined);
  expect(created).toEqual([]);
  expect(() => handle.close()).not.toThrow();
});
