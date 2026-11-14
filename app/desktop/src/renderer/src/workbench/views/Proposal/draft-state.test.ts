// The draft editor against a service that numbers versions as docs/proposals.md says: every version a new number,
// higher than any given before; my draft sits on the agent's latest version and a new one replaces it there; dropping
// it deletes it, so the agent's version is current again. Each sequence drives the reducer with saves, answers and
// reads in an order the network allows, and checks that no text is lost or replaced unannounced, and that the
// version Approve would name is the one the service holds.
import { expect, test } from "vitest";

import { type DraftRead, type DraftSave, draftSave, type DraftState, draftStep, type SaveOutcome, shownVersion } from "./draft-state.ts";

const FILE = "# Stock\n\nFlour: 40 kg\nButter: 12 kg\n";
const AGENT = "# Stock\n\nFlour: 40 kg\nButter: 30 kg\n";
const AGENT_AGAIN = "# Stock\n\nFlour: 40 kg\nButter: 30 kg\nEggs: 360\n";
const MINE = "# Stock\n\nFlour: 38 kg\nButter: 30 kg\n";
const MINE_MORE = "# Stock\n\nFlour: 38 kg (two sacks open)\nButter: 30 kg\n";

type Stored = { n: number; by: "agent" | "me"; text: string };

const fakeService = (first: string) => {
  const versions: Stored[] = [];
  let given = 0;
  const latestAgent = (): Stored => versions.findLast(({ by }) => by === "agent") ?? { n: 0, by: "agent", text: "" };
  const myDraft = () => versions.find(({ by, n }) => by === "me" && n > latestAgent().n);
  const current = (): Stored => versions.reduce((top, v) => (v.n > top.n ? v : top));
  const drop = (version: Stored | undefined) => {
    if (version !== undefined) versions.splice(versions.indexOf(version), 1);
  };
  const revise = (text: string) => {
    given += 1;
    versions.push({ n: given, by: "agent", text });
  };
  revise(first);
  return {
    revise,
    /** `PUT /draft`: "changed" unless `onVersion` is the agent's latest. */
    save: (onVersion: number, text: string): SaveOutcome => {
      if (onVersion !== latestAgent().n) return "changed";
      drop(myDraft());
      given += 1;
      versions.push({ n: given, by: "me", text });
      return { version: current().n };
    },
    /** `DELETE /draft`: refused when I have no draft. */
    clear: (): SaveOutcome => {
      const draft = myDraft();
      if (draft === undefined) throw new Error("DELETE /draft with no draft: the service refuses it");
      drop(draft);
      return { version: current().n };
    },
    read: (): DraftRead => ({ version: current().n, text: current().text, versions: versions.map(({ n, by }) => ({ n, by })) }),
    textOf: (n: number): string => versions.find((v) => v.n === n)?.text ?? "",
    current: () => current().n,
  };
};

type Service = ReturnType<typeof fakeService>;
type Pending = { save: DraftSave; shown: number; outcome?: SaveOutcome };

/** The editor as the draft hook drives it: each event through `draftStep`, each save built by `draftSave`. */
const editorOn = (service: Service) => {
  let state: DraftState | undefined;
  const now = (): DraftState => {
    if (state === undefined) throw new Error("the proposal wasn't read yet");
    return state;
  };
  const deliver = ({ save, shown }: Pending): SaveOutcome =>
    save.action === "save" ? service.save(save.onVersion, save.text) : save.action === "clear" ? service.clear() : { version: shown };
  return {
    now,
    read: () => {
      state = draftStep(state, { type: "read", read: service.read() });
    },
    type: (text: string) => {
      state = draftStep(state, { type: "typed", text });
    },
    send: (): Pending => {
      const save = draftSave(now(), service.textOf(now().base), FILE);
      if (save === undefined) throw new Error("nothing to save");
      const pending = { save, shown: shownVersion(now()) };
      state = draftStep(state, { type: "sent", save });
      return pending;
    },
    /** The service takes the save; its answer hasn't come back yet. */
    land: (pending: Pending) => {
      pending.outcome = deliver(pending);
    },
    answer: (pending: Pending) => {
      const outcome = pending.outcome ?? deliver(pending);
      state = draftStep(state, { type: "answered", save: pending.save, outcome });
      expect(shownVersion(now()), "the version Approve names is the one the service holds").toBe(service.current());
    },
  };
};

type Editor = ReturnType<typeof editorOn>;

test.each<[string, (editor: Editor, service: Service) => void]>([
  [
    "my saved text is what the editor shows, also when it is opened anew",
    (editor, service) => {
      editor.type(MINE);
      editor.answer(editor.send());
      editor.read();
      expect(editor.now().seed).toBe(MINE);
      const reopened = draftStep(undefined, { type: "read", read: service.read() });
      expect(reopened?.seed, "a fresh editor").toBe(MINE);
      expect(reopened && shownVersion(reopened), "a fresh editor names my draft").toBe(service.current());
    },
  ],
  [
    "the agent revises while my first edit is on its way: its text shows, and the notice says my edits were lost",
    (editor, service) => {
      editor.type(MINE);
      const sent = editor.send();
      service.revise(AGENT_AGAIN);
      editor.read();
      expect(editor.now().seed).toBe(AGENT_AGAIN);
      expect(editor.now().notice).toEqual({ draft: undefined, lost: true });
      editor.answer(sent);
      expect(editor.now().notice).toEqual({ draft: undefined, lost: true });
    },
  ],
  [
    "the agent revises while an edit past my draft is on its way: the notice keeps my draft and says the last edits were lost",
    (editor, service) => {
      editor.type(MINE);
      editor.answer(editor.send());
      const draft = service.current();
      editor.type(MINE_MORE);
      const sent = editor.send();
      service.revise(AGENT_AGAIN);
      editor.read();
      expect(editor.now().seed).toBe(AGENT_AGAIN);
      expect(editor.now().notice).toEqual({ draft, lost: true });
      editor.answer(sent);
      expect(editor.now().notice).toEqual({ draft, lost: true });
    },
  ],
  [
    "my own save read back before its answer leaves what I typed since in the editor",
    (editor, service) => {
      editor.type(MINE);
      const first = editor.send();
      editor.land(first);
      editor.type(MINE_MORE);
      editor.read();
      expect(editor.now().seed).toBe(MINE_MORE);
      editor.answer(first);
      editor.answer(editor.send());
      expect(service.read().text, "my latest text saved").toBe(MINE_MORE);
    },
  ],
  [
    "the agent revises after my edit landed but before its answer: the notice keeps my draft, nothing lost",
    (editor, service) => {
      editor.type(MINE);
      const sent = editor.send();
      editor.land(sent);
      const draft = service.current();
      service.revise(AGENT_AGAIN);
      editor.read();
      expect(editor.now().seed).toBe(AGENT_AGAIN);
      expect(editor.now().notice).toEqual({ draft, lost: false });
      editor.answer(sent);
      expect(editor.now().notice).toEqual({ draft, lost: false });
    },
  ],
  [
    "a draft dropped and saved again goes on the agent's version, and a revise then keeps the new draft",
    (editor, service) => {
      editor.type(MINE);
      editor.answer(editor.send());
      editor.read();
      editor.type(AGENT);
      editor.answer(editor.send());
      editor.read();
      editor.type(MINE_MORE);
      editor.answer(editor.send());
      editor.read();
      const draft = service.current();
      expect(service.textOf(draft)).toBe(MINE_MORE);
      service.revise(AGENT_AGAIN);
      editor.read();
      expect(editor.now().notice).toEqual({ draft, lost: false });
    },
  ],
])("%s", (_name, run) => {
  const service = fakeService(AGENT);
  const editor = editorOn(service);
  editor.read();
  run(editor, service);
});
