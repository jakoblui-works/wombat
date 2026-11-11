# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The Agents sidebar lists the agents grouped by state (Waiting on me, Working, Done, Error; stopped agents under Done) with title, folder, branch, the last message's excerpt and the time since you last interacted. A row opens or focuses the agent's chat tab; its menu stops or deletes the agent (delete asks first). New agent picks the folder (the workspace root first, then its repos; the last one used by default) and takes the first message. The service lists those folders at `GET /repos`.
- The app scaffold: a pnpm workspace with shared types, the agent service and the desktop app.
- The agent service's API, on 127.0.0.1 only: start a Claude Code agent in a repo of the workspace, send it messages, answer its permission requests, cancel a turn, and stop or delete the agent, with a stream of alerts whenever something changes. Every request needs the token from the discovery file.
- Agents use your own `claude` login. They get only an allowlisted environment: never the service's token, its `WOMBAT_*` settings or `ANTHROPIC_API_KEY`; `CLAUDE_CONFIG_DIR` is passed on when it's set.
- Agent history is kept in `$XDG_STATE_HOME/wombat/service.db` (`~/.local/state/wombat/service.db` by default, only you can read it), so it survives a restart of the service.
- Each agent runs in its own systemd user scope in `wombat-agents.slice`, so stopping or deleting it ends everything it started. The service stops anything left in that slice when it starts and when it shuts down. Without a usable systemd user manager, agents run as plain process groups and the service logs a warning.
- The agent service runs as a process: configured by `WOMBAT_WORKSPACE` (required), `WOMBAT_PORT` (default 14900, 0 for any free port) and `WOMBAT_STORE`; it writes `$XDG_RUNTIME_DIR/wombat/service.json` (only you can read it) so the app can find it, lets only one instance run per runtime folder (a second start names the running one and exits 0; the lock of a service that died is taken over), logs to stderr only, and on SIGINT or SIGTERM stops its agents and removes the file.
- Items: set `WOMBAT_ITEMS` to a folder of structures and item files and the service lists the structures (`GET /structures`), a structure's items (`GET /structures/:id/items`) and one item by handle or old handle (`GET /items/:handle`), invalid items included with their problems. Without `WOMBAT_ITEMS` these routes answer `items_not_configured`. The routes only read; agents change items through the agent tools, and you decide their proposals over the proposal routes.
- Agent tools: with `WOMBAT_ITEMS` set, every agent gets Wombat's ten item tools over MCP at `/mcp` to describe the structures, search, read, create, update and delete items, or propose those changes. A structure's access level (`hidden`, `read`, `propose` or `edit`) decides what an agent sees and may do, and locked fields can't be changed by an agent. Claude Code pre-allows the wombat tools, so it doesn't ask before each call.
- Agent token: each agent gets its own token for `/mcp`. It opens only `/mcp` (never the app's routes), is kept only in memory, and is revoked when the agent stops, is deleted or the service exits.
- Proposals: a proposal from an agent is stored in the service's store, listed with `GET /proposals?status=` and decided with `POST /proposals/:id/approve` or `POST /proposals/:id/reject`; each change sends a `proposal` alert. Approving re-checks the item's version and the structure's settings, and answers `conflict` with the reason instead of overwriting a change made since. A proposed create in a free-named structure carries its file path in its own `file` field (null for every other proposal), apart from its `fields` (title, body and properties), so a property named `file` is proposed like any other.
- Instructions file: the items of every structure marked `instructions: full` (each item in full) or `instructions: index` (each item's title and first line) are rendered into `<workspace>/.wombat/AGENTS.md`, outside every repo, read-only, with handles and never anything hidden. The service keeps it current: at start, after each of its writes and approvals, and shortly after you edit an item or a `_structure.yaml` by hand. Every new Claude Code agent gets it appended to its system prompt; agents already running keep the one they started with. A structure marked for instructions can't have `access: edit`, so every change to the instructions goes through your approval, and a file over 64 KiB is sent as an index of every structure.
- Agent summaries show what the app's agent list needs: the agent folder's git branch, an excerpt of the agent's last message, when you last sent it a message or answered it, and its open permission requests. A store from an earlier version is upgraded in place when the service starts.
- The service stores the agent's plan and its reasoning as they arrive, instead of skipping them.
- `POST /shutdown` stops every agent (their history is kept) and ends the service.
- An alert stream client that stops reading is disconnected once too many alerts wait for it. The stream doesn't replay: after any reconnect the app reads the agents, the proposals and each open agent's log again.
- A desktop app skeleton with secure defaults: context isolation on, no Node in the renderer, a strict content security policy.
- The desktop app asks for the workspace folder on first start, remembers it in `~/.config/Wombat/settings.json` (only you can read it), and starts the agent service for it when none is running. A service running for another workspace is restarted only when you say so.
- The desktop app reaches the service only through its main process, which holds the token and allows only the service's app routes. Its main process tracks whether it's connecting, connected, reconnecting, incompatible with the service's version, or failed, and reconnects when the service restarts or moves port.
- Quitting while agents work or wait asks whether to stop them or leave them running ("Don't ask again" turns the question off). The menu has Switch Workspace and Stop Service and Agents; both ask before stopping agents. Restarting a service from an older version of Wombat asks, then replaces it.
- A desktop notification says when an agent is waiting for you, without anything from the agent in it.
- The app's page is served with a content security policy header and a fresh nonce on every load; UI libraries (Tailwind, Base UI, dockview, Shiki, Monaco's diff editor) run under it.
- The desktop app has a workbench: an activity bar with five activities (Agents, and four that name the step that fills them), a sidebar, a split, tabbed editor area and a collapsible right sidebar. Agents opens each agent's chat in a tab. The layout (splits, tabs, sidebar widths) reopens per workspace; tabs of deleted agents close, and a layout that can't be restored opens the default without overwriting the saved one.
- The desktop app shows the connection to the service at the foot of the activity bar. When it's lost (or can't be made), a banner says so with a Restart button, and the views stay as they were, dimmed and unusable, until it's back.
- CI that lints, type-checks, tests, builds and runs the desktop end-to-end tests on every push and pull request.
- The Wombat logo: a mark and a symbol, in colour and in one colour, in `app/desktop/assets/brand/`; the mark heads the README.

### Changed

- The app needs Node 26 or newer (was 24).
