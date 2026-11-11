# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The app scaffold: a pnpm workspace with shared types, the agent service and the desktop app.
- The agent service's API, on 127.0.0.1 only: start a Claude Code agent in a repo of the workspace, send it messages, answer its permission requests, cancel a turn, and stop or delete the agent, with a stream of alerts whenever something changes. Every request needs the token from the discovery file.
- Agents use your own `claude` login. They get only an allowlisted environment: never the service's token, its `WOMBAT_*` settings or `ANTHROPIC_API_KEY`; `CLAUDE_CONFIG_DIR` is passed on when it's set.
- Agent history is kept in `$XDG_STATE_HOME/wombat/service.db` (`~/.local/state/wombat/service.db` by default, only you can read it), so it survives a restart of the service.
- Each agent runs in its own systemd user scope in `wombat-agents.slice`, so stopping or deleting it ends everything it started. The service stops anything left in that slice when it starts and when it shuts down. Without a usable systemd user manager, agents run as plain process groups and the service logs a warning.
- The agent service runs as a process: configured by `WOMBAT_WORKSPACE` (required), `WOMBAT_PORT` (default 14900, 0 for any free port) and `WOMBAT_STORE`; it writes `$XDG_RUNTIME_DIR/wombat/service.json` (only you can read it) so the app can find it, refuses to start while another instance is running, logs to stderr only, and on SIGINT or SIGTERM stops its agents and removes the file.
- Items: set `WOMBAT_ITEMS` to a folder of structures and item files and the service lists the structures (`GET /structures`), a structure's items (`GET /structures/:id/items`) and one item by handle or old handle (`GET /items/:handle`), invalid items included with their problems. Without `WOMBAT_ITEMS` these routes answer `items_not_configured`. The routes only read; agents change items through the agent tools, and you decide their proposals over the proposal routes.
- Agent tools: with `WOMBAT_ITEMS` set, every agent gets Wombat's ten item tools over MCP at `/mcp` to describe the structures, search, read, create, update and delete items, or propose those changes. A structure's access level (`hidden`, `read`, `propose` or `edit`) decides what an agent sees and may do, and locked fields can't be changed by an agent. Claude Code pre-allows the wombat tools, so it doesn't ask before each call.
- Agent token: each agent gets its own token for `/mcp`. It opens only `/mcp` (never the app's routes), is kept only in memory, and is revoked when the agent stops, is deleted or the service exits.
- Proposals: a proposal from an agent is stored in the service's store, listed with `GET /proposals?status=` and decided with `POST /proposals/:id/approve` or `POST /proposals/:id/reject`; each change sends a `proposal` alert. Approving re-checks the item's version and the structure's settings, and answers `conflict` with the reason instead of overwriting a change made since. A proposed create in a free-named structure carries its file path in its own `file` field (null for every other proposal), apart from its `fields` (title, body and properties), so a property named `file` is proposed like any other.
- Instructions file: the items of every structure marked `instructions: full` (each item in full) or `instructions: index` (each item's title and first line) are rendered into `<workspace>/.wombat/AGENTS.md`, outside every repo, read-only, with handles and never anything hidden. The service keeps it current: at start, after each of its writes and approvals, and shortly after you edit an item or a `_structure.yaml` by hand. Every new Claude Code agent gets it appended to its system prompt; agents already running keep the one they started with. A structure marked for instructions can't have `access: edit`, so every change to the instructions goes through your approval, and a file over 64 KiB is sent as an index of every structure.
- A desktop app skeleton with secure defaults: context isolation on, no Node in the renderer, a strict content security policy.
- CI that lints, type-checks, tests, builds and runs the desktop end-to-end tests on every push and pull request.
- The Wombat logo: a mark and a symbol, in colour and in one colour, in `app/desktop/assets/brand/`; the mark heads the README.

### Changed

- The app needs Node 26 or newer (was 24).
