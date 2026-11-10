// Lasting check (silent failure): hidden never reaches an agent. Nothing from a hidden structure (its id, name,
// handles, ids, titles, bodies or values) is in any read an agent makes, any search hit, any link value, describe's
// output or any refusal; a link to a hidden item reads null like a missing one, and a hidden handle or structure is
// refused exactly like a missing one, and a link to a hidden item gives the same problems as a link to a missing
// one, without scrubbing ordinary problems that merely share a word with a hidden name. The MCP layer's half is server/mcp-hidden.test.ts.
import { describe, expect, test } from "vitest";

import { AccessError } from "./access.ts";
import { renderInstructions } from "./instructions.ts";
import { ACCESS_FILES, AGENT, HIDDEN, MARKER, expectRefused, leaks, openAccessRoot, refusal } from "../../test/access-fixtures.ts";
import { HIDDEN_STRINGS, INSTRUCTIONS_FILES, UUID } from "../../test/instructions-fixtures.ts";
import { itemAt } from "../../test/items-fixtures.ts";

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
      { what: "describe", hidden: () => access.describe(HIDDEN.structure), missing: () => access.describe("no-such-structure"), typed: [HIDDEN.structure, "no-such-structure"] },
      { what: "list", hidden: () => access.list(HIDDEN.structure), missing: () => access.list("no-such-structure"), typed: [HIDDEN.structure, "no-such-structure"] },
      { what: "search in", hidden: () => access.search("plan", HIDDEN.structure), missing: () => access.search("plan", "no-such-structure"), typed: [HIDDEN.structure, "no-such-structure"] },
      { what: "update", hidden: () => access.update(AGENT, "KST-1", { codename: "x" }, "v"), missing: () => access.update(AGENT, "KST-99", { codename: "x" }, "v"), typed: ["KST-1", "KST-99"] },
      { what: "remove", hidden: () => access.remove(AGENT, "KST-1", "v"), missing: () => access.remove(AGENT, "KST-99", "v"), typed: ["KST-1", "KST-99"] },
      { what: "create", hidden: () => access.create(AGENT, HIDDEN.structure, input), missing: () => access.create(AGENT, "no-such-structure", input), typed: [HIDDEN.structure, "no-such-structure"] },
      { what: "propose_update", hidden: () => access.proposeUpdate(AGENT, "KST-1", { codename: "x" }, "v", "why"), missing: () => access.proposeUpdate(AGENT, "KST-99", { codename: "x" }, "v", "why"), typed: ["KST-1", "KST-99"] },
      { what: "propose_delete", hidden: () => access.proposeDelete(AGENT, "KST-1", "v", "why"), missing: () => access.proposeDelete(AGENT, "KST-99", "v", "why"), typed: ["KST-1", "KST-99"] },
      { what: "propose_create", hidden: () => access.proposeCreate(AGENT, HIDDEN.structure, input, "why"), missing: () => access.proposeCreate(AGENT, "no-such-structure", input, "why"), typed: [HIDDEN.structure, "no-such-structure"] },
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
      // What the agent typed may be echoed; nothing else of the hidden structure may.
      expect(leaks(JSON.stringify(underHidden), [MARKER, den, "Kestrel den", "KDN", "KNS", "inside another structure"]), what).toEqual([]);
      expect(await access.list(structure), `${what}: nothing was created under either folder`).toHaveLength(1);
    }
  });

  test("an ordinary value problem reads as the catalog gives it, even when its text contains a hidden structure's name", async () => {
    // The hidden structure is named with a common word that a visible field's problem also uses.
    const files = {
      ...ACCESS_FILES,
      "vault/_structure.yaml": `version: 1\nid: ${HIDDEN.structure}\nname: Owner\nprefix: ${HIDDEN.prefix}\naccess: hidden\nproperties:\n  codename: { type: text }\n`,
      "backlog/BL-3-owner-typo.md": `---\nid: 0196f3c2-9c00-7000-8000-000000000003\nhandle: BL-3\nproject: nope\nowner: 5\n---\n# An owner typed as a number\n\nInvented.\n`,
    };
    const { access, catalog } = openAccessRoot(files);
    const fromCatalog = itemAt(await catalog.items("backlog"), "backlog/BL-3-owner-typo.md").problems;
    expect(fromCatalog.map((problem) => problem.field).sort(), "the file has a problem on each value").toEqual(["owner", "project"]);

    expect((await access.get("BL-3")).problems, "get").toEqual(fromCatalog);
    expect((await access.list("backlog")).find((item) => item.handle === "BL-3")?.problems, "list").toEqual(fromCatalog);
  });

  test("a prefix clash with a hidden structure, in a folder or at the root, refuses a write the same way and names nothing hidden", async () => {
    const note = "---\nid: 0196f3c2-9e00-7000-8000-000000000051\nhandle: NOTE-1\n---\n# A note\n\nInvented.\n";
    const notes = (prefixProperty: boolean) =>
      `version: 1\nid: notes\nname: Notes\nprefix: NOTE\naccess: edit\n${prefixProperty ? "properties:\n  prefix: { type: text }\n" : ""}`;
    // A hidden structure with the visible one's prefix, in a folder of its own or at the items root itself.
    const den = (at: "" | "kestrel-secret/") => ({ [`${at}_structure.yaml`]: `version: 1\nid: ${MARKER}-secret\nname: Kestrel secret\nprefix: NOTE\naccess: hidden\n` });
    const hiddenStrings = [MARKER, ...HIDDEN.ids, HIDDEN.name, "Kestrel secret", "kestrel-secret/", "the structure in the root"];

    /** The refusals an agent gets for each write on notes: message and problems. */
    const refusals = async (files: Record<string, string>) => {
      const { access } = openAccessRoot({ ...ACCESS_FILES, ...files, "notes/NOTE-1-a-note.md": note });
      const version = (await access.get("NOTE-1")).version;
      const answers: Record<string, { message: string; problems: unknown }> = {};
      for (const [what, call] of [
        ["create", () => access.create(AGENT, "notes", { title: "Hi", body: "\nInvented.\n" })],
        ["update", () => access.update(AGENT, "NOTE-1", { title: "A renamed note" }, version)],
        ["remove", () => access.remove(AGENT, "NOTE-1", version)],
      ] as const) {
        const error = await refusal(call(), what);
        answers[what] = { message: error.message, problems: error.problems };
        expect(leaks(JSON.stringify(answers[what]), hiddenStrings), `${what}: names something hidden`).toEqual([]);
      }
      return answers;
    };

    const inFolder = await refusals({ "notes/_structure.yaml": notes(false), ...den("kestrel-secret/") });
    const atRoot = await refusals({ "notes/_structure.yaml": notes(false), ...den("") });
    expect(atRoot, "a hidden structure at the root reads like one in a folder").toEqual(inFolder);
    // A declared property named like a settings field doesn't open a way around it.
    await refusals({ "notes/_structure.yaml": notes(true), ...den("kestrel-secret/") });
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

    // The instructions file: the same files with the structures marked.
    const { catalog } = openAccessRoot({ ...INSTRUCTIONS_FILES, "bugs/BUG-2-hero-caption.md": files["bugs/BUG-2-hero-caption.md"], "backlog/BL-1-items.md": files["backlog/BL-1-items.md"] });
    const text = (await renderInstructions(catalog)) ?? "";
    expect(text, "the instructions file rendered the items").toContain("BUG-2");
    expect(leaks(text, HIDDEN_STRINGS), "the instructions file").toEqual([]);
    expect(UUID.exec(text)?.[0], "an id in the instructions file").toBeUndefined();
    expect(text).not.toContain("secretref");
  });
});
