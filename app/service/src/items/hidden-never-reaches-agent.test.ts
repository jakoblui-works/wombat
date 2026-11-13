// Hidden never reaches an agent. Nothing from a hidden structure (its id, name,
// handles, ids, titles, bodies or values) is in any read an agent makes, any search hit, any link value, describe's
// output or any refusal; a link to a hidden item reads null like a missing one, and a hidden handle or structure is
// refused exactly like a missing one, and a link to a hidden item gives the same problems as a link to a missing
// one, without scrubbing ordinary problems that merely share a word with a hidden name. A prefix clash with a hidden
// structure refuses edits and proposals alike without naming it, a handle with a hidden structure's prefix reads like
// one with a prefix no structure has, and no problem an agent gets carries more than the shared Problem's keys (the
// service's own `names` stay inside it).
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { AccessError } from "./access.ts";
import { ACCESS_FILES, AGENT, HIDDEN, MARKER, expectRefused, extraProblemKeys, leaks, openAccessRoot, refusal } from "../../test/access-fixtures.ts";
import { UUID } from "../../test/instructions-fixtures.ts";

/** The message with the name the agent typed replaced, so two refusals can be compared. */
const withoutTyped = (message: string, typed: string) => message.replaceAll(typed, "<typed>");

describe("hidden never reaches an agent", () => {
  test("no read, search hit, link value or describe output carries anything of a hidden structure", async () => {
    const { access } = openAccessRoot();
    const seen: unknown[] = [];

    const structures = await access.structures();
    seen.push(structures);
    expect(structures.map((structure) => structure.id).sort()).toEqual(["backlog", "bugs", "docs"]);
    for (const { id } of structures) {
      seen.push(await access.describe(id));
      const items = await access.list(id);
      seen.push(items);
      for (const item of items) if (item.handle !== null) seen.push(await access.get(item.handle));
    }
    for (const query of [MARKER, MARKER.toUpperCase(), "plan", "launch", "KST"]) {
      seen.push(await access.search(query));
      seen.push(await access.search(query, "bugs"));
    }

    const text = JSON.stringify(seen);
    expect(leaks(text, [MARKER, ...HIDDEN.ids, ...HIDDEN.handles, HIDDEN.structure, HIDDEN.name])).toEqual([]);
    expect(extraProblemKeys(seen), "keys beyond Problem's").toEqual([]);
    expect((await access.search(MARKER)).items).toEqual([]);
    const bug = await access.get("BUG-1");
    expect(bug.properties.vault, "a link to a hidden item").toBeNull();
    expect((await access.describe("bugs")).properties.vault?.to, "a link property to a hidden structure").toBeNull();
  });

  test("a hidden handle or structure is refused exactly like a missing one, and no refusal names anything hidden", async () => {
    const { access } = openAccessRoot();
    const version = (await access.get("BUG-2")).version;
    const input = { title: "A new plan", body: "\nInvented.\n" };
    const pairs: { what: string; hidden: () => Promise<unknown>; missing: () => Promise<unknown>; typed: [string, string] }[] = [
      { what: "get", hidden: () => access.get("KST-1"), missing: () => access.get("KST-99"), typed: ["KST-1", "KST-99"] },
      { what: "list", hidden: () => access.list(HIDDEN.structure), missing: () => access.list("no-such-structure"), typed: [HIDDEN.structure, "no-such-structure"] },
      { what: "create", hidden: () => access.create(AGENT, HIDDEN.structure, input), missing: () => access.create(AGENT, "no-such-structure", input), typed: [HIDDEN.structure, "no-such-structure"] },
      { what: "propose_update", hidden: () => access.proposeUpdate(AGENT, "KST-1", { codename: "x" }, "v", "why"), missing: () => access.proposeUpdate(AGENT, "KST-99", { codename: "x" }, "v", "why"), typed: ["KST-1", "KST-99"] },
      {
        what: "a link value naming a hidden handle",
        hidden: () => access.proposeUpdate(AGENT, "BUG-2", { vault: "KST-1" }, version, "why"),
        missing: () => access.proposeUpdate(AGENT, "BUG-2", { vault: "KST-99" }, version, "why"),
        typed: ["KST-1", "KST-99"],
      },
    ];

    for (const { what, hidden, missing, typed } of pairs) {
      const hiddenMessage = await expectRefused(hidden(), "not_found", `${what} (hidden)`);
      const missingMessage = await expectRefused(missing(), "not_found", `${what} (missing)`);
      expect(withoutTyped(hiddenMessage, typed[0]), what).toBe(withoutTyped(missingMessage, typed[1]));
      // What the agent typed may be echoed; nothing else of the hidden structure may.
      expect(leaks(withoutTyped(hiddenMessage, typed[0]), [MARKER, ...HIDDEN.ids, HIDDEN.name]), what).toEqual([]);
      const error = await refusal(hidden(), what);
      expect(leaks(JSON.stringify(error.problems)), `${what}: problems`).toEqual([]);
      expect(extraProblemKeys({ problems: error.problems }), `${what}: keys beyond Problem's`).toEqual([]);
    }
    expect(await access.proposals(), "no refused call stored a proposal").toEqual([]);
  });

  test("a link to a hidden item gives an agent the same problems as a link to a missing one", async () => {
    // Pairs of files that differ only in a link value: one names a hidden item, the other an item that doesn't exist.
    const missingId = "0196f3c2-9f00-7000-8000-000000000099";
    const pairs = [
      // `vault` links into the hidden structure: the catalog finds the hidden target but reports the missing one.
      { what: "a hidden id in a link to the hidden structure", structure: "bugs", field: "vault", hidden: HIDDEN.ids[1], missing: missingId, files: [["BUG-3", "0196f3c2-9e00-7000-8000-000000000001"], ["BUG-4", "0196f3c2-9e00-7000-8000-000000000002"]] },
      // `parent` links into a visible structure: the catalog reports both, naming the hidden item or structure.
      { what: "a hidden id in a link to a visible structure", structure: "backlog", field: "parent", hidden: HIDDEN.ids[0], missing: missingId, files: [["BL-3", "0196f3c2-9e00-7000-8000-000000000003"], ["BL-4", "0196f3c2-9e00-7000-8000-000000000004"]] },
      { what: "a hidden handle in a link to a visible structure", structure: "backlog", field: "parent", hidden: HIDDEN.handles[1], missing: "KST-99", files: [["BL-5", "0196f3c2-9e00-7000-8000-000000000005"], ["BL-6", "0196f3c2-9e00-7000-8000-000000000006"]] },
    ] as const;
    const files: Record<string, string> = { ...ACCESS_FILES };
    for (const { structure, field, hidden, missing, files: [toHidden, toMissing] } of pairs) {
      for (const [[handle, id], value] of [[toHidden, hidden], [toMissing, missing]] as const) {
        files[`${structure}/${handle}-a-link.md`] = `---\nid: ${id}\nhandle: ${handle}\n${field}: ${value}\n---\n# A link to check\n\nInvented.\n`;
      }
    }
    const { access } = openAccessRoot(files);

    /** An item's problems as `get` and `list` give them, with the file's link value replaced, so a pair can be compared. */
    const problemsOf = async (structure: string, handle: string, value: string) => {
      const fromGet = (await access.get(handle)).problems;
      const fromList = (await access.list(structure)).find((item) => item.handle === handle)?.problems;
      expect(fromList, `${handle} in list(${structure})`).toEqual(fromGet);
      expect(extraProblemKeys({ problems: fromGet }), `${handle}: keys beyond Problem's`).toEqual([]);
      return { raw: JSON.stringify(fromGet), compared: JSON.parse(JSON.stringify(fromGet).replaceAll(value, "<value>")) as unknown };
    };

    for (const { what, structure, field, hidden, missing, files: [[hiddenLink], [missingLink]] } of pairs) {
      const toHidden = await problemsOf(structure, hiddenLink, hidden);
      const toMissing = await problemsOf(structure, missingLink, missing);
      // Same fields, same messages, and present or absent alike.
      expect(toHidden.compared, what).toEqual(toMissing.compared);
      // The file's value isn't the agent's to echo when it names something hidden; nothing else hidden may show either.
      expect(leaks(toHidden.raw, [MARKER, ...HIDDEN.ids, ...HIDDEN.handles, HIDDEN.structure, HIDDEN.name]), `${what}: problems`).toEqual([]);
      expect((await access.get(hiddenLink)).properties[field], `${what}: the value reads null`).toBeNull();
      // Which way it goes: a link property to a hidden structure (`to: null` in describe) shows no link problem, since
      // the agent can link nothing there; a link property to a visible structure shows the missing-target problem.
      const onField = (toMissing.compared as { field?: string; message: string }[]).filter(
        (problem) => problem.field === field || problem.message.includes(field),
      );
      expect(onField.length, `${what}: problems on ${field}`).toBe(structure === "bugs" ? 0 : 1);
    }
  });

  test("a free-naming create under a hidden structure's folder is refused exactly like one under a folder that doesn't exist", async () => {
    // Visible free-naming structures (one per writing level) whose folders hold a hidden structure's folder.
    const free = (id: string, level: string, den: string, prefix: string, n: number): Record<string, string> => ({
      [`${id}/_structure.yaml`]: `version: 1\nid: ${id}\nname: ${id}\nprefix: ${id.toUpperCase()}\naccess: ${level}\nnaming: free\ninclude: ["**/*.md"]\n`,
      [`${id}/existing/keep.md`]: `---\nid: 0196f3c2-9e00-7000-8000-00000000002${n}\nhandle: ${id.toUpperCase()}-1\n---\n# Keep\n\nInvented.\n`,
      [`${id}/${den}/_structure.yaml`]: `version: 1\nid: ${den}\nname: Kestrel den\nprefix: ${prefix}\naccess: hidden\n`,
      [`${id}/${den}/${prefix}-1-plan.md`]: `---\nid: 0196f3c2-9a00-7000-8000-00000000002${n}\nhandle: ${prefix}-1\n---\n# Kestrel den plan\n\nKestrel.\n`,
    });
    const { access } = openAccessRoot({ ...ACCESS_FILES, ...free("notes", "edit", "kestrel-den", "KDN", 1), ...free("drafts", "propose", "kestrel-nest", "KNS", 2) });
    const input = (file: string) => ({ title: "A note", body: "\nInvented.\n", file });

    /** What the agent got: the refusal with the typed path replaced, or that the call went through. */
    const outcome = async (call: Promise<unknown>, file: string) => {
      try {
        await call;
        return { accepted: true };
      } catch (error) {
        expect(error, file).toBeInstanceOf(AccessError);
        const { code, message, problems } = error as AccessError;
        return JSON.parse(JSON.stringify({ code, message, problems }).replaceAll(file, "<typed>")) as unknown;
      }
    };

    for (const { what, structure, den, call } of [
      { what: "create", structure: "notes", den: "kestrel-den", call: (file: string) => access.create(AGENT, "notes", input(file)) },
      { what: "propose_create", structure: "drafts", den: "kestrel-nest", call: (file: string) => access.proposeCreate(AGENT, "drafts", input(file), "why") },
    ]) {
      const typed = [`${den}/a-note.md`, "no-such-folder/a-note.md"] as const;
      const underHidden = await outcome(call(typed[0]), typed[0]);
      const underMissing = await outcome(call(typed[1]), typed[1]);
      expect(underHidden, what).toEqual(underMissing);
      expect(extraProblemKeys(underHidden), `${what}: keys beyond Problem's`).toEqual([]);
      // What the agent typed may be echoed; nothing else of the hidden structure may.
      expect(leaks(JSON.stringify(underHidden), [MARKER, den, "Kestrel den", "KDN", "KNS", "inside another structure"]), what).toEqual([]);
      expect(await access.list(structure), `${what}: nothing was created under either folder`).toHaveLength(1);
    }
  });

  test("a prefix clash with a hidden structure, in a folder or at the root, refuses a write or a proposal the same way and names nothing hidden", async () => {
    const note = "---\nid: 0196f3c2-9e00-7000-8000-000000000051\nhandle: NOTE-1\n---\n# A note\n\nInvented.\n";
    const notes = (level: "edit" | "propose", prefixProperty: boolean) =>
      `version: 1\nid: notes\nname: Notes\nprefix: NOTE\naccess: ${level}\n${prefixProperty ? "properties:\n  prefix: { type: text }\n" : ""}`;
    // A hidden structure with the visible one's prefix, in a folder of its own or at the items root itself.
    const den = (at: "" | "kestrel-secret/") => ({ [`${at}_structure.yaml`]: `version: 1\nid: ${MARKER}-secret\nname: Kestrel secret\nprefix: NOTE\naccess: hidden\n` });
    const hiddenStrings = [MARKER, ...HIDDEN.ids, HIDDEN.name, "Kestrel secret", "kestrel-secret/", "the structure in the root"];
    const input = { title: "Hi", body: "\nInvented.\n" };

    /** The refusals an agent gets for each change on notes, through the level's own tools: message and problems. */
    const refusals = async (level: "edit" | "propose", files: Record<string, string>) => {
      const { access } = openAccessRoot({ ...ACCESS_FILES, ...files, "notes/NOTE-1-a-note.md": note });
      const version = (await access.get("NOTE-1")).version;
      const calls =
        level === "edit"
          ? ([
              ["create", () => access.create(AGENT, "notes", input)],
              ["update", () => access.update(AGENT, "NOTE-1", { title: "A renamed note" }, version)],
              ["remove", () => access.remove(AGENT, "NOTE-1", version)],
            ] as const)
          : ([
              ["propose_create", () => access.proposeCreate(AGENT, "notes", input, "why")],
              ["propose_update", () => access.proposeUpdate(AGENT, "NOTE-1", { title: "A renamed note" }, version, "why")],
              ["propose_delete", () => access.proposeDelete(AGENT, "NOTE-1", version, "why")],
            ] as const);
      const answers: Record<string, { message: string; problems: unknown }> = {};
      for (const [what, call] of calls) {
        const error = await refusal(call(), `${what} in ${level}`);
        answers[what] = { message: error.message, problems: error.problems };
        expect(leaks(JSON.stringify(answers[what]), hiddenStrings), `${what}: names something hidden`).toEqual([]);
        expect(extraProblemKeys(answers[what]), `${what}: keys beyond Problem's`).toEqual([]);
      }
      expect(await access.proposals(), `${level}: no refused call stored a proposal`).toEqual([]);
      return answers;
    };

    for (const level of ["edit", "propose"] as const) {
      const inFolder = await refusals(level, { "notes/_structure.yaml": notes(level, false), ...den("kestrel-secret/") });
      const atRoot = await refusals(level, { "notes/_structure.yaml": notes(level, false), ...den("") });
      expect(atRoot, `${level}: a hidden structure at the root reads like one in a folder`).toEqual(inFolder);
      // A declared property named like a settings field doesn't open a way around it.
      await refusals(level, { "notes/_structure.yaml": notes(level, true), ...den("kestrel-secret/") });
    }
  });

  test("a visible item whose handle has a hidden structure's prefix gets the same problems as one with a prefix no structure has", async () => {
    // The mismatch names only the item's own handle, never the structure that owns the prefix.
    const odd = (handle: string, n: number) => `---\nid: 0196f3c2-9e00-7000-8000-00000000007${String(n)}\nhandle: ${handle}\nrepo: api\n---\n# A handle typed by hand\n\nInvented.\n`;
    const files = { ...ACCESS_FILES, "bugs/odd-hidden-prefix.md": odd(`${HIDDEN.prefix}-7`, 1), "bugs/odd-no-prefix.md": odd("ZZQ-7", 2) };
    const { access } = openAccessRoot(files);

    /** The item's problems as get and list give them, with its own handle replaced. */
    const problemsOf = async (handle: string) => {
      const fromGet = (await access.get(handle)).problems;
      expect((await access.list("bugs")).find((item) => item.handle === handle)?.problems, `${handle} in list`).toEqual(fromGet);
      expect(extraProblemKeys({ problems: fromGet }), `${handle}: keys beyond Problem's`).toEqual([]);
      return JSON.parse(JSON.stringify(fromGet).replaceAll(handle, "<handle>")) as unknown;
    };

    const noStructure = await problemsOf("ZZQ-7");
    expect(noStructure, "the mismatch is a problem on the handle").toEqual([expect.objectContaining({ field: "handle" })]);
    expect(await problemsOf(`${HIDDEN.prefix}-7`)).toEqual(noStructure);
  });

  test("an agent sees only a visible item's declared properties, so an undeclared key carries nothing (no id) to it", async () => {
    const withKey = (path: string) => (ACCESS_FILES[path] ?? "").replace("---\n# ", `secretref: ${HIDDEN.ids[1]}\nnoteref: KST-2 ${MARKER}\n---\n# `);
    const files = { ...ACCESS_FILES, "bugs/BUG-2-hero-caption.md": withKey("bugs/BUG-2-hero-caption.md"), "backlog/BL-1-items.md": withKey("backlog/BL-1-items.md") };
    const { access } = openAccessRoot(files);
    const shapes: { what: string; structure: string; item: { properties: Record<string, unknown> } | undefined }[] = [];
    for (const [handle, structure] of [["BUG-2", "bugs"], ["BL-1", "backlog"]] as const) {
      shapes.push({ what: `get ${handle}`, structure, item: await access.get(handle) });
      shapes.push({ what: `list ${structure}`, structure, item: (await access.list(structure)).find((item) => item.handle === handle) });
    }
    shapes.push({ what: "search", structure: "bugs", item: (await access.search("hero caption")).items.find((item) => item.handle === "BUG-2") });

    for (const { what, structure, item } of shapes) {
      expect(item, what).toBeDefined();
      const declared = Object.keys((await access.describe(structure)).properties);
      expect(Object.keys(item?.properties ?? {}).filter((key) => !declared.includes(key)), `${what}: undeclared keys`).toEqual([]);
      expect(leaks(JSON.stringify(item), [MARKER, ...HIDDEN.ids, ...HIDDEN.handles]), what).toEqual([]);
      expect(UUID.exec(JSON.stringify(item))?.[0], `${what}: an id`).toBeUndefined();
    }
  });

  test("a visible structure nested in a hidden structure's folder never shows the hidden folder, in problems or refusals", async () => {
    // A nested structure's access covers only its own files, so visible structures inside a hidden folder are valid.
    const hr = { id: "zephyr-hr", name: "Zephyr HR", prefix: "ZHR", itemId: "0196f3c2-9a00-7000-8000-000000000081" };
    const id = (n: number) => `0196f3c2-9e00-7000-8000-00000000008${String(n)}`;
    const files = {
      "zephyr-hr/_structure.yaml": `version: 1\nid: ${hr.id}\nname: ${hr.name}\nprefix: ${hr.prefix}\naccess: hidden\n`,
      "zephyr-hr/ZHR-1-salaries.md": `---\nid: ${hr.itemId}\nhandle: ZHR-1\n---\n# Salaries\n\nInvented.\n`,
      // Handle-named and edited directly.
      "zephyr-hr/public/_structure.yaml": "version: 1\nid: pub\nname: Public notes\nprefix: PUB\naccess: edit\nproperties:\n  note: { type: text }\n  echo: { type: text }\n",
      "zephyr-hr/public/PUB-1-first.md": `---\nid: ${id(1)}\nhandle: PUB-1\n---\n# One of two with this handle\n\nInvented.\n`,
      "zephyr-hr/public/PUB-1-second.md": `---\nid: ${id(2)}\nhandle: PUB-1\n---\n# The other with this handle\n\nInvented.\n`,
      "zephyr-hr/public/PUB-3-untitled.md": `---\nid: ${id(3)}\nhandle: PUB-3\n---\nNo heading here.\n`,
      // A value another key aliases: changing it can't be done in place.
      "zephyr-hr/public/PUB-4-anchored.md": `---\nid: ${id(4)}\nhandle: PUB-4\nnote: &shared seen twice\necho: *shared\n---\n# An anchored note\n\nInvented.\n`,
      // Another, with a subfolder that can't be read (made below), which refuses every write in it.
      "zephyr-hr/archive/_structure.yaml": "version: 1\nid: archive\nname: Archive\nprefix: ARC\naccess: edit\n",
      // Free-named, beside it.
      "zephyr-hr/drafts/_structure.yaml": "version: 1\nid: drafts\nname: Drafts\nprefix: DRF\naccess: edit\nnaming: free\ninclude: [\"**/*.md\"]\n",
      "zephyr-hr/drafts/existing.md": `---\nid: ${id(6)}\nhandle: DRF-1\n---\n# Existing\n\nInvented.\n`,
    };
    const { access, root } = openAccessRoot(files);
    // A subfolder of archive that can't be read.
    const locked = join(root, "zephyr-hr", "archive", "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    onTestFinished(() => chmodSync(locked, 0o755));

    /** What the agent got from a call: the answer, or the refusal's code, message and problems. */
    const answer = async (call: () => Promise<unknown>) => {
      try {
        return await call();
      } catch (error) {
        expect(error).toBeInstanceOf(AccessError);
        const { code, message, problems } = error as AccessError;
        return { code, message, problems };
      }
    };
    const version = async (handle: string) => ((await answer(() => access.get(handle))) as { version?: string }).version ?? "v";
    const answers: Record<string, unknown> = {
      "list pub": await answer(() => access.list("pub")),
      "get PUB-1 (a shared handle)": await answer(() => access.get("PUB-1")),
      "update PUB-1 (a shared handle)": await answer(async () => access.update(AGENT, "PUB-1", { note: "x" }, await version("PUB-1"))),
      "remove PUB-1 (a shared handle)": await answer(async () => access.remove(AGENT, "PUB-1", await version("PUB-1"))),
      "create in archive (an unreadable subfolder)": await answer(() => access.create(AGENT, "archive", { title: "A new note", body: "\nInvented.\n" })),
      "update PUB-3 (no title, fixed by hand)": await answer(async () => access.update(AGENT, "PUB-3", { note: "x" }, await version("PUB-3"))),
      "update PUB-4 (an anchored value, changed by hand)": await answer(async () => access.update(AGENT, "PUB-4", { note: "seen once" }, await version("PUB-4"))),
      "create in drafts onto an existing file": await answer(() => access.create(AGENT, "drafts", { title: "A draft", body: "\nInvented.\n", file: "existing.md" })),
    };

    // Each answer is refused or carries problems, so the oracle below looks at real text.
    for (const [what, got] of Object.entries(answers)) expect(JSON.stringify(got), what).toContain('"message"');
    const hiddenNames = ["zephyr", hr.name, hr.itemId, "ZHR-"];
    const leaked: Record<string, string[]> = {};
    for (const [what, got] of Object.entries(answers)) {
      const found = leaks(JSON.stringify(got), hiddenNames);
      if (found.length > 0) leaked[what] = found;
    }
    expect(leaked, "answers naming the hidden folder, structure or item").toEqual({});
  });

  test("a link to a structure that doesn't exist answers the same whether or not a hidden structure is under the root", async () => {
    const pub = {
      "pub/_structure.yaml": "version: 1\nid: pub\nname: Public notes\nprefix: PUB\naccess: edit\nproperties:\n  ref: { type: link, to: nowhere }\n",
      "pub/PUB-1-a-note.md": "---\nid: 0196f3c2-9e00-7000-8000-000000000091\nhandle: PUB-1\n---\n# A note\n\nInvented.\n",
    };
    const hidden = { "vault/_structure.yaml": `version: 1\nid: ${HIDDEN.structure}\nname: ${HIDDEN.name}\nprefix: ${HIDDEN.prefix}\naccess: hidden\n` };

    /** What an agent gets about pub: describe, list, get and a refused write's code, message and problems. */
    const seen = async (files: Record<string, string>) => {
      const { access } = openAccessRoot(files);
      const error = await refusal(access.create(AGENT, "pub", { title: "Another note", body: "\nInvented.\n" }), "create in pub");
      const item = await access.get("PUB-1");
      return {
        describe: await access.describe("pub"),
        list: await access.list("pub"),
        get: { ...item, version: "<version>" },
        create: { code: error.code, message: error.message, problems: error.problems },
      };
    };

    const without = await seen(pub);
    expect(JSON.stringify(without.create), "the refusal is about the link's target").toContain("nowhere");
    const withHidden = await seen({ ...pub, ...hidden });
    expect(withHidden).toEqual(without);
    expect(leaks(JSON.stringify(withHidden), [MARKER, HIDDEN.structure, HIDDEN.name]), "hidden names").toEqual([]);
  });

  test("a free path through a hidden folder to a visible structure inside it is refused like a path through a missing folder", async () => {
    const files = {
      ...ACCESS_FILES,
      "a/_structure.yaml": "version: 1\nid: pub\nname: Public notes\nprefix: PUB\naccess: edit\nnaming: free\ninclude: [\"**/*.md\"]\n",
      "a/h/_structure.yaml": `version: 1\nid: hx\nname: Kestrel hutch\nprefix: HX\naccess: hidden\n`,
      "a/h/v/_structure.yaml": "version: 1\nid: v2\nname: Inner notes\nprefix: VTW\naccess: edit\nnaming: free\ninclude: [\"**/*.md\"]\n",
    };
    const { access } = openAccessRoot(files);
    const input = (file: string) => ({ title: "A note", body: "\nInvented.\n", file });

    /** The refusal with the typed path replaced, or that the call went through. */
    const outcome = async (file: string) => {
      try {
        await access.create(AGENT, "pub", input(file));
        return { accepted: true };
      } catch (error) {
        expect(error, file).toBeInstanceOf(AccessError);
        const { code, message, problems } = error as AccessError;
        return JSON.parse(JSON.stringify({ code, message, problems }).replaceAll(file, "<typed>")) as unknown;
      }
    };

    const missing = await outcome("q/v/x.md");
    expect(missing, "a path through a missing folder is refused").not.toEqual({ accepted: true });
    expect(await outcome("h/x.md"), "a path into the hidden folder").toEqual(missing);
    expect(await outcome("h/v/x.md"), "a path through the hidden folder to a visible structure").toEqual(missing);
    expect(await access.list("pub"), "nothing was created").toEqual([]);
  });

  test("a value of the wrong type for a link to a hidden structure is refused without naming it, whichever hidden structure it is", async () => {
    // An edit twin of bugs' link into the hidden structure.
    const notes = (to: string) => `version: 1\nid: notes\nname: Notes\nprefix: NOTE\naccess: edit\nproperties:\n  vault: { type: link, to: ${to} }\n`;
    const note = "---\nid: 0196f3c2-9e00-7000-8000-0000000000e1\nhandle: NOTE-1\n---\n# A note\n\nInvented.\n";
    const standard = { ...ACCESS_FILES, "notes/_structure.yaml": notes(HIDDEN.structure), "notes/NOTE-1-a-note.md": note };
    // The same root with another hidden structure as the links' target: what an agent gets mustn't tell them apart.
    const other = { id: "osprey-archive", name: "Osprey archive", prefix: "OSP" };
    const renamed = Object.fromEntries(
      Object.entries(standard).map(([path, text]) => [
        path,
        text.replaceAll(HIDDEN.structure, other.id).replaceAll(HIDDEN.name, other.name).replaceAll(`prefix: ${HIDDEN.prefix}`, `prefix: ${other.prefix}`),
      ]),
    );

    /** The refusals for non-text values in the link, through both families: code, message and problems. */
    const answers = async (files: Record<string, string>) => {
      const { access } = openAccessRoot(files);
      const version = async (handle: string) => (await access.get(handle)).version;
      const calls = {
        "propose_update with a number": async () => access.proposeUpdate(AGENT, "BUG-2", { vault: 5 }, await version("BUG-2"), "why"),
        "propose_create with a list": () => access.proposeCreate(AGENT, "bugs", { title: "A new bug", properties: { vault: ["a"] } }, "why"),
        "update with a number": async () => access.update(AGENT, "NOTE-1", { vault: 5 }, await version("NOTE-1")),
        "create with a list": () => access.create(AGENT, "notes", { title: "A new note", body: "\nInvented.\n", properties: { vault: ["a"] } }),
      };
      const got: Record<string, { code: string; message: string; problems: unknown }> = {};
      for (const [what, call] of Object.entries(calls)) {
        const error = await refusal(call(), what);
        got[what] = { code: error.code, message: error.message, problems: error.problems };
      }
      return got;
    };

    const fromStandard = await answers(standard);
    for (const [what, got] of Object.entries(fromStandard)) {
      expect(got.code, what).toBe("invalid_fields");
      expect(leaks(JSON.stringify(got), [MARKER, HIDDEN.structure, HIDDEN.name, `${HIDDEN.prefix}-`]), `${what}: names the hidden structure`).toEqual([]);
    }
    expect(await answers(renamed), "with another hidden structure as the target").toEqual(fromStandard);
  });

  test("a free path through a visible structure's folder into a hidden one inside it is refused like a path to a missing folder there", async () => {
    const files = {
      ...ACCESS_FILES,
      "notes/_structure.yaml": 'version: 1\nid: notes\nname: Notes\nprefix: NOTE\naccess: edit\nnaming: free\ninclude: ["**/*.md"]\n',
      "notes/team/_structure.yaml": "version: 1\nid: team\nname: Team\nprefix: TEAM\naccess: edit\n",
      "notes/team/secret/_structure.yaml": `version: 1\nid: ${MARKER}-secret\nname: Kestrel secret\nprefix: KSC\naccess: hidden\n`,
    };
    const { access } = openAccessRoot(files);

    /** The refusal with the typed path replaced, or that the call went through. */
    const outcome = async (file: string) => {
      try {
        await access.create(AGENT, "notes", { title: "A note", body: "\nInvented.\n", file });
        return { accepted: true };
      } catch (error) {
        expect(error, file).toBeInstanceOf(AccessError);
        const { code, message, problems } = error as AccessError;
        return JSON.parse(JSON.stringify({ code, message, problems }).replaceAll(file, "<typed>")) as unknown;
      }
    };

    const missing = await outcome("team/nothere/x.md");
    expect(missing, "a path to a missing folder in team is refused").not.toEqual({ accepted: true });
    expect(await outcome("team/secret/x.md"), "a path into the hidden folder in team").toEqual(missing);
  });

  test("a hidden structure sharing a visible one's id hides both: its items are never served under the visible id", async () => {
    const twinItem = `---\nid: 0196f3c2-9b00-7000-8000-000000000042\nhandle: BUG-90\nrepo: api\n---\n# The ${MARKER} incident\n\nNotes on the ${MARKER} incident.\n`;
    const { access } = openAccessRoot({
      ...ACCESS_FILES,
      // As when a structure's settings are copied to make a hidden variant, and the id is left as it was.
      "bugs-private/_structure.yaml": (ACCESS_FILES["bugs/_structure.yaml"] ?? "").replace("access: propose", "access: hidden").replace("locked: [repo, body]\n", ""),
      "bugs-private/BUG-90-incident.md": twinItem,
    });

    await expectRefused(access.list("bugs"), "not_found", "list of the shared id");
    await expectRefused(access.get("BUG-90"), "not_found", "get of the hidden twin's item");
    expect(leaks(JSON.stringify(await access.search(MARKER)))).toEqual([]);
  });
});
