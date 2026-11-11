// Search as an agent sees it: a case-insensitive substring of an item's title, body or text properties (never
// other property values), within one structure when asked, at most 50 hits with `truncated` saying there were more.
import { describe, expect, test } from "vitest";

import { SEARCH_LIMIT } from "./access.ts";
import { openAccessRoot } from "../../test/access-fixtures.ts";

const handles = (result: { items: { handle: string | null }[] }) => result.items.map((item) => item.handle).sort();

/** An edit structure with `count` items, each with "Widget" in its title. */
const widgets = (count: number) => ({
  "widgets/_structure.yaml": "version: 1\nid: widgets\nname: Widgets\nprefix: WID\naccess: edit\n",
  ...Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`widgets/WID-${index + 1}-widget.md`, `---\nhandle: WID-${index + 1}\n---\n# Widget ${index + 1}\n`]),
  ),
});

describe("search", () => {
  test("matches the title, body and text properties without regard to case, and no other property", async () => {
    const { access } = openAccessRoot();

    expect(handles(await access.search("LOGIN TIMES"))).toEqual(["BUG-1"]);
    expect(handles(await access.search("zen at 1280"))).toEqual(["BUG-2"]);
    expect(handles(await access.search("session CALL"))).toEqual(["BUG-1"]);
    expect(handles(await access.search("site-web"))).toEqual([]);
  });

  test("keeps to one structure when asked", async () => {
    const { access } = openAccessRoot();

    expect(handles(await access.search("plan", "backlog"))).toEqual(["BL-1", "BL-2"]);
    expect(handles(await access.search("plan"))).toEqual(["BL-1", "BL-2", "BUG-1", "DOC-1"]);
  });

  test(`answers at most ${SEARCH_LIMIT} items, with truncated saying there were more`, async () => {
    const many = await openAccessRoot(widgets(SEARCH_LIMIT + 1)).access.search("widget");
    const exact = await openAccessRoot(widgets(SEARCH_LIMIT)).access.search("widget");

    expect(many.items).toHaveLength(SEARCH_LIMIT);
    expect(many.truncated).toBe(true);
    expect(exact.items).toHaveLength(SEARCH_LIMIT);
    expect(exact.truncated).toBe(false);
  });
});
