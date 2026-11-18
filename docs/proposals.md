# Proposals

A proposal is a change an agent suggests and you decide on. The agent sends it, the service keeps it, and nothing changes until you approve it. You can approve it, reject it, or adjust it first with your own version.

There are two kinds. A file proposal changes a plain text file. An item proposal changes an [item](items.md) in a binder with `access: propose`. Both are listed, read and decided through the same routes, and both use `revise_proposal`.

## Agent tools

An agent gets all of these tools over `/mcp`. `propose_change` and `revise_proposal` work with or without `WOMBAT_ITEMS`; the item tools need it. Every refusal is a tool error that says what went wrong and what to do next. A refused call stores nothing: a refused propose makes no proposal, and a refused revise leaves the proposal as it was. For a refused `propose_change` or `revise_proposal` the service logs one `tool_refused` line with the agent and the tool, nothing of the call. A `reason` longer than the reason limit (see [Limits](#limits)) is refused by the tool's input check, for every propose tool and `revise_proposal`.

### `propose_change`

Proposes a change to a text file. The file stays as it is until you approve. The agent keeps working without waiting for your decision.

| Input | Takes |
|---|---|
| `path` | the file's path: absolute, or relative to the folder the agent works in |
| `reason` | why the agent proposes it, for you; at most the reason limit |
| `edits` | for an existing file: a list of `{ old, new }` replacements, applied in order. Each `old` occurs exactly once in the file as the edits before it leave it, and no text along the way may be larger than the size limit |
| `content` | for a new file: its whole text |

Send `edits` or `content`, never both. The answer is `{ "proposed": id }`.

The path can be anywhere, also outside the workspace. A proposal outside the workspace carries `outsideWorkspace: true`, so the app can mark it. The mark is a warning, not a boundary: you decide every proposal either way.

A path the items own, an item's file or a binder's `_binder.yaml`, is refused. The agent changes those with the item tools.

Refusals:

| Refusal | Next step |
|---|---|
| Both or neither of `edits` and `content` | send one of them; `edits` must not be empty |
| `edits` for a file that doesn't exist | send `content` instead |
| `content` for a file that exists | send `edits` instead |
| An edit's `old` is empty, isn't found, or is found more than once | read the file again and copy `old` exactly, with enough surrounding text to be unique |
| An edit's `old` is over the old-text limit | use a shorter `old` that is still unique; split a long change into several edits |
| More edits than the edits limit | combine neighbouring edits into fewer, larger ones |
| The edits change nothing | propose something that differs from the file |
| The path ends with `/`, is a folder, isn't a regular file, or can't be read | give the path of a regular file |
| The folder of a new file doesn't exist | give a path in an existing folder; a proposal adds a file, not a folder |
| The path is a symlink to a file that doesn't exist, or leads to something that can't be resolved | give the path the file should have, or its real path |
| The file belongs to the items | use the item tools |
| The text isn't UTF-8, or is larger than the size limit (also a text the edits pass through on the way) | propose a smaller change, or tell the user what you'd change |
| A relative path, and the folder the agent works in is gone | give the file's absolute path |
| The agent is at the cap of open proposals | keep working until you decide some |

### `propose_create`, `propose_update`, `propose_delete`

Propose a change to an item in a binder open to proposals. The answer is `{ "proposed": id }`.

| Tool | Inputs |
|---|---|
| `propose_create` | `binder` (its id), `title`, `reason`; optional `body`, `properties` (name → value, links as handles) and `file` (only for a binder with free naming: the new file's path, relative to the binder's folder) |
| `propose_update` | `handle`, `fields` (only the fields to change: `title`, `body` or property names), `version` (from the agent's last `get_item`), `reason` |
| `propose_delete` | `handle`, `version`, `reason` |

The checks are the ones a direct change runs, in the same order, so a proposal that is stored can be approved unless something changes first. The refusals are the item tools': an unknown or hidden binder or handle (both read as not found), a binder that is `read` only or open to direct changes (use `create_item`, `update_item` or `delete_item` instead), a locked field, a `version` that is no longer the item's (read it again), invalid fields, a file or binder with problems, and an item without an id yet (it can't be deleted). The same cap applies.

### `revise_proposal`

Revises one of the agent's own proposals that you haven't decided yet (`pending` or `conflict`), instead of proposing anew. You see it as a new version of the same proposal.

| Input | Takes |
|---|---|
| `id` | the id the propose call answered |
| `reason` | why this version: what changed and why; at most the reason limit |
| `edits` | for a file proposal: `{ old, new }` replacements to the text the proposal holds now |
| `content` | for a file proposal: the whole new text |
| `fields` | for an item proposal: the fields it should set instead of the ones it sets now |

Send `edits` or `content` for a file proposal, and `fields` for an item proposal. The answer is `{ "revised": id, "version": n }`. A revision does not count toward the cap of open proposals. Once a proposal has as many versions as the versions limit, your drafts counted, the agent's revise is refused; your drafts and approve's re-applied versions are never refused and can take it past the limit.

When the proposal was a conflicting file edit or item update, the new version is rebuilt on the file or item as it is now, so it holds only this revision's changes, none of the earlier versions'. The answer then has `"rebuilt": true`, and a second text block says so. A conflicting create (a file or an item) is revised on its own text or fields, like a pending one, and never answers `rebuilt`.

A refused revise stores nothing and leaves the proposal as it was.

| Refusal | Next step |
|---|---|
| The id isn't the agent's, the proposal is decided, or it is being applied right now | the same words for all of these: check the id; if it is being applied, wait for the outcome with your next message instead of proposing it again; if it was decided, propose anew |
| The proposal is at the versions limit | ask the user to decide on it as it is, or to reject it and propose anew |
| Wrong inputs for the kind: `fields` on a file proposal, `edits` or `content` on an item proposal, both `edits` and `content`, or none | send what the proposal's kind takes |
| An edit doesn't match exactly once | check the text the proposal holds now (on a conflict: the file as it is now) and copy `old` exactly; to replace the whole text, send `content` |
| An edit's `old` is over the old-text limit, or more edits than the edits limit | use a shorter `old` that is still unique, or combine edits; or send `content` |
| The content, edits or fields equal what the proposal holds | change something, or leave it |
| The text isn't UTF-8 or is over the size limit (also a text the edits pass through on the way) | send a smaller text |
| A delete proposal: it has no fields | to keep the item, ask the user to reject the proposal; to still delete it after a conflict, read the item and propose the delete again |
| An item proposal: the item is gone, or moved to another binder | read it again and propose anew |
| An item proposal: its binder can't be reached anymore (hidden from the agent now, gone, or its settings broke) | the refusal names neither the item nor the binder: ask the user to reject the proposal |
| An item proposal: the binder's level, a locked field or an invalid field refuses the fields | the refusal is the one of the item tools: fix the fields, or ask the user |
| An item proposal: a revised create whose fields or file no longer fit the binder | fix them as the refusal says |
| An item proposal while the service has no items | tell the user |
| On a conflict: the file is an item's file now | use the item tools, and ask the user to reject this proposal |
| On a conflict: the path leads somewhere else now than when it was proposed (a folder on it, or the file, became a symlink) | the refusal doesn't say where: propose the change again on the path you mean, and ask the user to reject this proposal |
| On a conflict: a proposal to create a file, and something exists at the path now (a file, a folder or a dangling link) | if it is the file you meant, propose an edit with `propose_change`; either way ask the user to reject this proposal |
| On a conflict: the file is gone | propose it again with `content` |
| On a conflict: the content equals the file now | nothing is left to propose: ask the user to reject this proposal |

## Statuses

| Status | Meaning |
|---|---|
| `pending` | waits for you |
| `applying` | you approved it and the service is writing it. Nothing else can happen to it until that ends |
| `approved` | written |
| `rejected` | you rejected it; nothing was written |
| `conflict` | the file or item changed since the proposal, or the change doesn't fit anymore; nothing was written |

The moves:

| From | To | When |
|---|---|---|
| `pending` | `applying` | you approve |
| `applying` | `approved` | the write succeeded |
| `applying` | `conflict` | the target changed, or the change no longer fits |
| `applying` | `pending` | the write failed for another reason (the disk, a restart while writing), so you can approve it again |
| `pending` or `conflict` | `rejected` | you reject |
| `conflict` | `pending` | the agent revises it |

`approved` and `rejected` are final. A `pending` proposal may carry a `problem`: the target's state stopped the write (a read-only file, a missing folder, a file the service can't read), and nothing was written. Fix the target and approve the same version again, or reject it.

A conflict can be rejected or revised, never approved, and it takes no draft.

## Versions

A proposal has numbered versions, from 1. A revision by the agent adds a version. The current version is the highest. Approving names the version you looked at, so you approve what you saw: if it changed since, the service answers `proposal_changed`.

Your own version is a draft. It holds the whole text (or an item's fields) and sits on top of the agent's latest version. It is the current version until the agent revises: the agent's new version then becomes current, and your draft stays in `versions` as history. A new draft replaces your earlier one on the same agent version, and you can drop the draft to bring the agent's version back.

`editedByMe` is `true` while the current version is yours. That includes a proposal you approved from your draft, or one that ended as a conflict on it.

You can save a draft only on a `pending` proposal. It is refused when:

- it is the same as the agent's version: there is nothing to save (if your edit is current, drop it to show the agent's version again);
- it has the wrong shape for the kind (`text` for an item, `fields` for a file);
- a file's text isn't UTF-8 or is over the size limit;
- an item's fields don't pass the writer's checks (the error then carries `problems`, see Routes), or the item is gone or moved to another binder (reject the proposal);
- the proposal is a delete, which has no fields.

Approving a draft writes your version. The agent's locks on an item's fields don't bind it.

## Approving a changed file or item

Approving never overwrites what changed since the proposal. The service writes only onto the file as the proposal read it, or onto the item at the version the agent read, and under the binder's settings as they are now.

For a file:

- The file is unchanged: it is written, and the proposal becomes `approved`.
- The file changed, and the stored edits still apply to it exactly once each: the service re-applies them and the proposal stays `pending` with a new version, based on the file as it is now. Review it and approve again.
- The file changed and the edits no longer fit, the file is gone, or the version has no edits to apply again (your draft, or a revision by `content`): the proposal becomes `conflict` with a `problem` that says why.
- A proposal to create a file never replaces one that appeared meanwhile: it becomes `conflict`.
- The path leads somewhere else now than when it was proposed: the file, or for a new file its folder, is no longer its own real path (a folder on the way, or the file, was replaced by a symlink). The proposal becomes `conflict` and nothing is written; reject it, or ask the agent to propose it again. This is checked right before the file is read and again before a re-read; a swap in the moment between the last check and the write itself can't be caught.

For an item, a change since the agent read it (edited, renamed, deleted, moved) makes the proposal a `conflict` with a `problem`. So does its binder becoming `hidden` or `read` (agents' changes no longer apply to it; one opened to direct changes still takes the proposal), its settings being gone or broken, or a field the agent's version sets becoming locked; your own version isn't bound by the agent's locks.

The write is atomic and happens exactly once. It replaces the file's directory entry with a new file: a second hard link to the old file keeps the old content. A symlink at the path is never written through: for an edit the path then leads somewhere else (the conflict above), and a new file finds something already there. The new file keeps the old one's mode, but not its owner, ACLs or extended attributes. If the service dies while a proposal is `applying`, it checks at the next start what the target holds: a write that landed is `approved`, any other is `pending` again.

### The base on a revise

A `pending` proposal keeps its base. The agent's edits apply to the text the proposal holds now, and they extend the chain of edits, so approving on a changed file re-applies the whole chain. Sending `content`, revising after your draft, or a chain with more edits than the edits limit or more old and new text together than the size limit breaks the chain: the version keeps no edits, a later approve can't re-apply, and a changed file ends as a conflict.

A conflicting file edit or item update is rebuilt on the file or item as it is now. The agent's edits or fields apply to that, and it becomes the new base. A conflicting create is revised on its own text or fields. Either way the proposal is `pending` again.

## Limits

- The cap: an agent has at most 20 proposals counting toward it, those that are `pending` or `conflict`. A proposal being applied doesn't count. Decide some, and the agent can propose again.
- The size limit: a file proposal holds at most 512 KiB of UTF-8 text. The same limit applies to the file's text it is read against, to every text an agent's edits pass through, to your draft, and to the old and new text of a version's chain of edits together (past it the version keeps no edits).
- The versions limit: 50 versions, your drafts counted. At it the agent's `revise_proposal` is refused; your drafts and approve's re-applied versions are not, and can take a proposal past it.
- The edits limit: one call applies at most 100 edits, and a version keeps its chain of edits only while it has at most 100 (past it the version keeps no edits, like `content`).
- The old-text limit: one edit's `old` is at most 64 KiB of UTF-8 text.
- The reason limit: a reason is at most 4 KiB of UTF-8 text, the agent's on a proposal or a version and yours on a reject.
- A note's diff: at most 100 changed lines, and at most 200 lines and 16 KiB with context, two unchanged lines around each change (see [What the agent is told](#what-the-agent-is-told)).

## Routes

Every route needs the service's token, like the rest of the API. An error answers `{ "error": { "code", "message", "hint"?, "problems"? } }`.

| Route | Body | Answers |
|---|---|---|
| `GET /proposals?status=` | | `{ proposals }`, oldest first, without content. `status` is one of the five statuses |
| `GET /proposals/:id?version=` | | the proposal with `current` (the target as it is now, `null` if it doesn't exist or a file can't be read as text), the version's `text` (a file) or `fields` (an item), and `versions` (`n`, `by`, `at`, `reason`). An edit of a file that is pending or in conflict also has `baseChanged`: `true` when the file is no longer the version the current version was made on. Approving then applies the current version's stored edits to the file again, as a new version, if it has edits that still fit; a version without stored edits (your draft, or a revision by `content`) ends as a conflict. Without `version`, the current one |
| `POST /proposals/:id/approve` | `{ version }` | the proposal after the approve: `approved`, `conflict`, or `pending` with a new version |
| `POST /proposals/:id/reject` | `{ reason? }`, at most the reason limit | the rejected proposal |
| `PUT /proposals/:id/draft` | `{ onVersion, text }` for a file, `{ onVersion, fields }` for an item | the proposal with your version current. Item fields that don't pass the writer's checks answer `invalid_request` with `problems`: `[{ field?, line?, message }]`, the problems the [items](items.md) API lists, one per problem: `field` the field it is about (`title`, `body` or a property's name) and `line` the file's line, when it has them; the message lists the same problems. Your version saved before stays current |
| `DELETE /proposals/:id/draft` | | the proposal with the agent's version current |

Every proposal has `target` (`file` or `item`), `id`, `status`, `agentId`, `reason`, `version`, `editedByMe`, `at`, and when set `decidedAt`, `rejectReason` and `problem`. A file proposal adds `path` (its real path, symlinks resolved), `outsideWorkspace` and `kind` (`edit` or `create`). An item proposal adds `binder` (its id), `kind` (`create`, `update` or `delete`), `handle` (`null` for a create until it is approved) and `file` (a create's file path in a free-named binder, else `null`). Every change to a proposal sends a `proposal` alert.

Error codes:

| Code | Status | When |
|---|---|---|
| `proposal_not_found` | 404 | no proposal has the id, it has no version `?version=` names, or a message's `proposalId` isn't one of that agent's open proposals |
| `proposal_not_pending` | 409 | the proposal can't be decided now: it is being applied or already decided; for a draft, it isn't `pending` |
| `proposal_changed` | 409 | an approve names a version that isn't current, or a `PUT` draft names an `onVersion` that isn't the agent's latest version. Fetch the proposal and try again |
| `invalid_request` | 400 | the body or query is wrong, or a draft can't be made or dropped (see Versions), including `DELETE` when you have no draft |
| `items_not_configured` | 409 | an item proposal while the service has no items |

## What the agent is told

An agent learns the outcome of a proposal when you write to it, not before. A decision never starts a turn.

With your next message to the agent, the service puts a note in front of it:

- Each outcome the agent hasn't been told yet: `approved`, `approved_with_changes`, `rejected` (with your reason, or that you gave none) or `conflict` (with the problem, for a file; an item conflict carries none). Each shows the proposal's id and its label: a file's path, an item's handle (or "a new item" or "an item" when the agent may not see a handle). An outcome is told once.
- `approved_with_changes` whenever the version approved was yours. For a file, the note shows your changes as a diff against the agent's version, with unchanged lines around each change. An empty diff means only the final newline differs. For an item it shows no diff.
- When your message is about one of the agent's open proposals (`proposalId` on the message), the note names that proposal and tells the agent to revise it with `revise_proposal`. If you had edited it, the note shows your changes against the agent's version.

A diff is kept only while it is within the note's diff limits (see [Limits](#limits)). Past them, the entry holds `diffTooLarge` and the note says the changes are too large to show and tells the agent to read the file or ask you. `diffContinues` marks a diff with unchanged lines after its last line.

A note that never reached the agent (a resume that failed, was cancelled or was stopped before the message was handed over) is told again with your next message.

A message that starts with `/` carries no note, because a note in front would stop it being a command. Its outcomes wait for the next message. A message that starts with `/` and carries a `proposalId` answers 400 `invalid_request`.

`POST /agents/:id/messages` takes an optional `proposalId`. It must be one of that agent's open proposals (`pending` or `conflict`), or the call answers `proposal_not_found`.

The note is stored in the agent's log as a `proposal_note` entry, right before the message's `user_message`. It is structured: `outcomes` (`proposalId`, `label`, `outcome`, and `reason`, `diff`, `diffContinues` or `diffTooLarge` when they apply) and the `reference` of the message's proposal. The agent reads its rendering as text, followed by the message you typed.
