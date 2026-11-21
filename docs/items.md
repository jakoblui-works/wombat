# Items

Items are markdown files that you and your agents work on together: bugs, backlog entries, conventions, documents. Wombat reads them from a folder on your machine, the items root, and gives agents tools to read them and change them. Each change goes through the rules you set for its binder.

In the app, choose the items root with the Desk's Choose items folder… button, or later with Choose Items Folder… in the File menu. The app saves it per workspace in its `settings.json` and restarts the service with it, asking first when agents have a process. A folder that doesn't exist, isn't a folder or can't be read is refused, and the items root stays as it was. The app ignores a `WOMBAT_ITEMS` it inherits from your shell.

When you run the service on its own, set the items root with `WOMBAT_ITEMS`, an absolute path. Without an items root, the service runs without items.

## Binders

A binder is a folder with a `_binder.yaml` in it. Every markdown file below that folder belongs to it, up to the next folder that has its own `_binder.yaml`. A file belongs to exactly one binder, so a nested binder's access level covers only its own files. Folders starting with `.` and `node_modules` are never read.

In the app, New binder at the top of the Desk's tree (or in its empty state), or the + on a drawer's row, asks for a name, a handle prefix and a folder, and writes a starter `_binder.yaml` there; everything after that you edit by hand, and the Desk follows. The prefix and folder are suggested from the name. The folder is relative to the items root, or to the drawer you started from, and may hold `/` to make new drawers. The starter for "Team Chores" with the prefix `CHORE`:

```yaml
version: 1
id: team-chores
name: Team Chores
prefix: CHORE
access: read
views:
  - name: List
    kind: list
```

A folder that still holds a `_structure.yaml`, the file's old name, and no `_binder.yaml` shows the problem `_structure.yaml: rename this file to _binder.yaml` and doesn't load: its files are in no binder until you rename the file, and its settings aren't read. Beside a `_binder.yaml`, the old file is a leftover whose problem asks you to delete it; the binder loads and is written as usual.

```yaml
version: 1
id: bugs
name: Bugs
prefix: BUG
access: propose
properties:
  repo: { type: select, options: [site-web, api], required: true }
  noted: { type: date }
views:
  - { name: By repo, kind: board, column: repo }
```

### Keys

| Key | Required | Takes | Default |
|---|---|---|---|
| `version` | yes | `1` | |
| `id` | yes | a lowercase letter, then up to 39 lowercase letters, digits or `-`. Links and the API name the binder by its id, so it stays the same when the folder moves | |
| `name` | yes | the name the app shows | |
| `prefix` | yes | the handle prefix: `BUG` in `BUG-14`. An uppercase letter, then up to 9 uppercase letters or digits | |
| `access` | yes | what agents can do: `hidden`, `read`, `propose` or `edit` (below) | |
| `naming` | no | `handle`: files the service creates are named `BUG-14-<slug>.md`. `free`: the binder's files are the ones `include` matches | `handle` |
| `include` | with `naming: free` | globs relative to the binder's folder, like `["*.md"]`. No `..`, `\`, `{` or `}` | |
| `instructions` | no | whether every new agent starts with these items in its instructions: `off`, `full` or `index` (below) | `off` |
| `locked` | no | fields agents can't change: `title`, `body` or property names. Only in a `propose` or `edit` binder | `[]` |
| `properties` | no | a map of property name to property (below) | `{}` |
| `views` | no | a list of views (below) | `[]` |

Every binder under the root needs its own `id` and its own `prefix`.

### Access levels

| Level | Agents can |
|---|---|
| `hidden` | do nothing. They never see the binder, its items, or messages that name it |
| `read` | read and search its items |
| `propose` | read, and propose creates, changes and deletes. Each [proposal](proposals.md) waits for your approval |
| `edit` | read, and create, change and delete items directly |

`locked` fields can't be changed by agents at any level. You can always change any file by hand.

### Instructions

`full` puts each item's title and body into the instructions file (`AGENTS.md`) that every new agent starts with. `index` puts one line per item there, and the agent reads the rest through its tools. If the file would be larger than 64 KiB, every binder is written as an index.

An instructions binder can't be `edit`: one agent could then change every later agent's instructions without your approval. Use `propose`. It can't be `hidden` either.

### Properties

Each property has a `type`, and an optional `required: true`.

| Type | Value in the file | Extra keys |
|---|---|---|
| `select` | one of its options | `options`: a list of values, each listed once |
| `text` | text | |
| `date` | `"YYYY-MM-DD"` | |
| `number` | a number | |
| `link` | the target item's handle or id | `to`: the id of the target's binder |

A property can't be called `id`, `handle`, `aliases`, `title` or `body`: those are the item's own fields.

### Views

Each view has a `name`, a `kind`, and optionally a `filter` (a map of property to value) and a `sort` (a list of property names, the first sorting first).

| Kind | Extra key |
|---|---|
| `list` | `group`: a property to group by (optional). `excerpt` (optional): absent or `true` draws its rows rich (title, excerpt, values), `false` titles only |
| `board` | `column`: a `select` property. The app shows a board view as a list grouped by its column: one group per option that has items, in option order, then one for the items without a value. `excerpt` (optional): as on a list |
| `tree` | `parent`: a `link` property to this same binder. Each item nests under the item it links to |

## Item files

```markdown
---
repo: site-web
---
# The caption shows through the x-ray on short screens

The body: everything after the title line.
```

- **Frontmatter:** the property values, between `---` lines at the top. It's optional.
- **Title:** the first non-blank line after the frontmatter, a `# ` heading.
- **Body:** everything after the title line.

The first time Wombat reads a file, it adds an `id` and a `handle` to its frontmatter, and replaces a handle typed into a link field with the target's id, so links survive renames. It changes only those keys and leaves every other byte as it was. The id never changes. The handle (`BUG-14`) is what you and agents type. If you change a handle by hand, keep the old one under `aliases` so links typed with it still work.

Wombat never writes to a file in a binder with problems, to a file without a valid title, or to a file outside every binder.

## Problems

Wombat doesn't drop a broken binder or item. The app lists it with its problems. Each problem names the key or line and says what to write instead. An item with only value problems, such as a select value that isn't an option, can still be fixed through the tools.

## The API

`GET /items/:ref` answers one item with its body. `ref` is the item's id, its handle or one of its aliases, tried in that order.

Every item the API sends (`GET /binders/:id/items`, `GET /items/:ref` and the answers to the writes below) carries `binder`, the id of its binder, and `excerpt`: the body's first paragraph (its first block of non-blank lines), with a leading list, quote or heading marker (`- `, `* `, `+ `, `1. `, `> `, `# ` to `###### `) removed, whitespace folded to single spaces and cut to at most 1,000 characters (UTF-16 code units), ending in "…" when cut. Markdown inside it stays as written. `excerpt` is `null` when the body has no text or the file can't be parsed. Agents' tools don't carry either.

The app writes items through three routes. They check the values as an agent's writes are checked, but access levels and locked fields don't apply: you can change anything an agent may only propose.

- `POST /binders/:id/items` with `{ title, body, properties, file? }` creates an item and answers it (201) with its new handle. `file` is for free-named binders only. A link value may be the target's handle or id.
- `PATCH /items/:ref` with `{ version, fields }` changes an item and answers it. `fields` holds only what changes: `title`, `body` or property names; `null` clears a property. `version` is the version you read.
- `DELETE /items/:ref?version=<version>` deletes the item's file (204). Its handle number is never given out again.

`POST /binders` with `{ path, name, prefix, adopt? }` creates a binder and answers it (201) as `GET /binders` lists it. `path` is its folder relative to the items root, with `/`; missing folders on the way are created. The service writes `<path>/_binder.yaml` with the starter above: the id is the name's slug (lowercase letters and digits, words joined by `-`), access is `read`, and there's one list view named List. It's refused with `400 invalid_fields`, and nothing written, when:

- `name`: the id made from it is taken by another binder (hidden ones too), or doesn't fit the id's pattern (a lowercase letter first, at most 40 characters).
- `prefix`: another binder (hidden ones too) has it, or it isn't an uppercase letter followed by up to 9 uppercase letters or digits.
- `path`: it isn't a plain relative path inside the items root (absolute, or with `..`), it's in a dot folder or `node_modules`, it goes through a symlink or a file, its folder already holds a `_binder.yaml` or `_structure.yaml`, or it's inside a binder with `naming: free` whose `include` reaches it.
- `adopt`: the folder already holds Markdown files the new binder would take as its items (the next read writes an id and a handle into each); send `adopt: true` to create it anyway.

A refused write changes nothing on disk and answers one of:

- `409 stale_version`: the file changed since `version`. Read the item again and redo the change.
- `400 invalid_fields`: the values don't fit the binder. `problems` lists each one as `{ field, message }`.
- `400 field_not_writable`: the change names a field the service sets itself, `id` or `handle`. Leave it out; a handle changes only by hand, with the old one kept in `aliases`.
- `404 item_not_found` or `binder_not_found`: no item has that id, handle or alias, or no binder that id.
- `409 items_not_writable`: the item or its binder needs a fix by hand first: its handle is shared with another file, its file has problems on disk (or no handle yet), or the binder's `_binder.yaml` has problems. `problems` lists what to fix, as above. It's also the answer, without `problems`, when the items folder can't take the write.

Every change to an item file or a binder's `_binder.yaml` sends an `items` alert on `GET /events`: `{ seq, dbId, type: "items" }`. It covers the service's own writes (your writes through these routes, a new binder, agents' tools, approved proposals) and edits made by hand, which Wombat notices about 200 ms after the last one. The alert says only that something changed, never which item or what; the app reads its binders and items again. A write of the service's can send two alerts, one for the write and one when the watch sees the file change. Its `seq` is on the same sequence as the other alerts.
