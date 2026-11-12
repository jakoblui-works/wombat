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

/** A sink over a fake that keeps its listeners by event; its notices are fixed texts (the quit's keptNotice). */
const sinkByEvent = ({ e2e = false, supported = true } = {}) => {
  const listeners = new Map<string, (() => void)[]>();
  const logged: string[] = [];
  const show = noticeSink({
    e2e,
    record: () => undefined,
    isSupported: () => supported,
    create: () => ({
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      show: () => undefined,
      close: () => undefined,
    }),
    log: (line) => logged.push(line),
  });
  return { show, fire: (event: string) => listeners.get(event)?.forEach((listener) => listener()), logged };
};

const NOTICE = { title: "Wombat", body: "The agent service is still running with 1 agent. Open Wombat to stop it." };

/** Whether `promise` has settled by the time the microtasks queued now have run. */
const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false;
  void promise.then(() => (done = true));
  await new Promise((resolve) => setImmediate(resolve));
  return done;
};

test.each(["show", "failed"])("`shown` settles once the desktop reports the notification's %s, not before", async (event) => {
  const { show, fire } = sinkByEvent();
  const sent = show(NOTICE);
  expect(await settled(sent.shown)).toBe(false);
  fire(event);
  expect(await settled(sent.shown)).toBe(true);
});

test("under e2e `shown` settles at once; where notifications aren't supported it does too, and the log says so", async () => {
  expect(await settled(sinkByEvent({ e2e: true }).show(NOTICE).shown)).toBe(true);
  const unsupported = sinkByEvent({ supported: false });
  expect(await settled(unsupported.show(NOTICE).shown)).toBe(true);
  expect(unsupported.logged).toEqual([`This desktop can't show notifications, so Wombat couldn't show "${NOTICE.body}".`]);
});
