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
- A desktop app skeleton with secure defaults: context isolation on, no Node in the renderer, a strict content security policy.
- CI that lints, type-checks, tests, builds and runs the desktop end-to-end tests on every push and pull request.
- The Wombat logo: a mark and a symbol, in colour and in one colour, in `app/desktop/assets/brand/`; the mark heads the README.

### Changed

- The app needs Node 26 or newer (was 24).
