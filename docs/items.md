# Items

Items are markdown files that you and your agents work on together: bugs, backlog entries, conventions, documents. Wombat reads them from a folder on your machine, the items root, and gives agents tools to read them and change them. Each change goes through the rules you set for its structure.

Set the items root with `WOMBAT_ITEMS`, an absolute path. Without it, the service runs without items.

## Structures

A structure is a folder with a `_structure.yaml` in it. Every markdown file below that folder belongs to it, up to the next folder that has its own `_structure.yaml`. A file belongs to exactly one structure, so a nested structure's access level covers only its own files. Folders starting with `.` and `node_modules` are never read.

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
| `id` | yes | a lowercase letter, then up to 39 lowercase letters, digits or `-`. Links and the API name the structure by its id, so it stays the same when the folder moves | |
| `name` | yes | the name the app shows | |
| `prefix` | yes | the handle prefix: `BUG` in `BUG-14`. An uppercase letter, then up to 9 uppercase letters or digits | |
| `access` | yes | what agents can do: `hidden`, `read`, `propose` or `edit` (below) | |
| `naming` | no | `handle`: files the service creates are named `BUG-14-<slug>.md`. `free`: the structure's files are the ones `include` matches | `handle` |
| `include` | with `naming: free` | globs relative to the structure's folder, like `["*.md"]`. No `..`, `\`, `{` or `}` | |
| `instructions` | no | whether every new agent starts with these items in its instructions: `off`, `full` or `index` (below) | `off` |
| `locked` | no | fields agents can't change: `title`, `body` or property names. Only in a `propose` or `edit` structure | `[]` |
| `properties` | no | a map of property name to property (below) | `{}` |
| `views` | no | a list of views (below) | `[]` |

Every structure under the root needs its own `id` and its own `prefix`.

### Access levels

| Level | Agents can |
|---|---|
| `hidden` | do nothing. They never see the structure, its items, or messages that name it |
| `read` | read and search its items |
| `propose` | read, and propose creates, changes and deletes. Each proposal waits for your approval |
| `edit` | read, and create, change and delete items directly |

`locked` fields can't be changed by agents at any level. You can always change any file by hand.

### Instructions

`full` puts each item's title and body into the instructions file (`AGENTS.md`) that every new agent starts with. `index` puts one line per item there, and the agent reads the rest through its tools. If the file would be larger than 64 KiB, every structure is written as an index.

An instructions structure can't be `edit`: one agent could then change every later agent's instructions without your approval. Use `propose`. It can't be `hidden` either.

### Properties

Each property has a `type`, and an optional `required: true`.

| Type | Value in the file | Extra keys |
|---|---|---|
| `select` | one of its options | `options`: a list of values, each listed once |
| `text` | text | |
| `date` | `"YYYY-MM-DD"` | |
| `number` | a number | |
| `link` | the target item's handle or id | `to`: the id of the target's structure |

A property can't be called `id`, `handle`, `aliases`, `title` or `body`: those are the item's own fields.

### Views

Each view has a `name`, a `kind`, and optionally a `filter` (a map of property to value) and a `sort` (a list of property names, the first sorting first).

| Kind | Extra key |
|---|---|
| `list` | `group`: a property to group by (optional) |
| `board` | `column`: a `select` property. Each item's card sits in the column of its value |
| `tree` | `parent`: a `link` property to this same structure. Each item nests under the item it links to |

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

The first time Wombat reads a file, it adds an `id` and a `handle` to its frontmatter. It changes only those two keys and leaves every other byte as it was. The id never changes. The handle (`BUG-14`) is what you and agents type. If you change a handle by hand, keep the old one under `aliases` so links typed with it still work. A handle typed into a link field is replaced by the target's id, so links survive renames.

Wombat never writes to a file in a structure with problems, to a file without a valid title, or to a file outside every structure.

## Problems

Wombat doesn't drop a broken structure or item. The app lists it with its problems. Each problem names the key or line and says what to write instead. An item with only value problems, such as a select value that isn't an option, can still be fixed through the tools.
