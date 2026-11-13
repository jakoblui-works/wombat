# Wombat

Wombat is an agentic development environment (ADE) for multi-repo projects. It sets up a sandbox around the project (a Lima VM running NixOS, built from one `wombat.yml`) so agents can work across all its repos without reaching the host, keeps an index of the code and the contracts between the repos for agents to query, and has an optional app (a desktop app and its agent service) for working with the agents. The design, decision log and release plan live in a private design doc (see the parent `CLAUDE.md`); read the sections relevant to the task.

## How to work on this project

- Follow the release plan's milestones in order: the app (on the host), the sandbox prototype, the sandbox core loop, working in it, the index, instances, fast first boot. Don't start a milestone until the previous one's exit check passes.
- At the end of a step, propose ticking the done items in the design doc; I review and commit doc changes myself.
- Built for my own use, public and easy to extend. Keep scope narrow: don't build anything listed under "Later" unless I ask.
- The decision log is settled. If a task seems to need a different choice, stop and ask before changing it, then update the decision log.
- The prototype project is the JakobLui platform (the sibling repos). Its components are described in `platform-docs/architecture.md`; ask me for anything the dev setup needs that isn't there (run commands, dev ports, env vars).
- Explain Lima, NixOS and Nix concepts briefly when they come up; they're new to me.

## Layout

- One repo for every part:
  - `python/`: the sandbox and the index (the `wombat` CLI), a uv project.
  - `app/`: TypeScript, a pnpm workspace: `service/` (the agent service), `desktop/` (Electron + React), `shared/` (types shared by both).
  - App tests: unit tests beside the code (`*.test.ts`); process and cross-layer tests and shared fixtures in `<package>/test/`. A file mixing both is split when touched.
  - Run the unit tests one package at a time (`pnpm -r --workspace-concurrency=1 test`); in parallel, some main-process tests time out.
  - `prototype/`: the hand-built sandbox (a NixOS image built with nixos-generators, Lima config, `flake.nix`, `compose.yml`, `process-compose.yaml`, Traefik config, a playbook, a tmux script), before any of it is templated.
  - `docs/`: the docs, later built into the site.
- The core (`python/`) never refers to `app/`; CI checks it. The app reaches the core only through its public interfaces (the CLI's JSON output, the index's MCP server), never by importing its code.

## The app

- Agents run through ACP, the Agent Client Protocol. Each agent tool gets one harness adapter behind one interface; Claude Code (through `claude-agent-acp`) is the first.
- Every wait on an agent process or an ACP response has a timeout, and what happens when it fires is stated: what the user sees and the state the agent is left in.
- The agent service owns the agents and keeps them running when the desktop app closes. The desktop app talks only to the agent service, over one port, so it doesn't change when the service moves from the host into the VM.
- The service runs git through simple-git (the real `git` CLI).
- The desktop app: Electron + React, Monaco with Shiki for code. Context isolation on, no Node in the renderer; everything goes through the service.
- Tool-specific behaviour lives in the service's harness. A tool's desktop UI lives in `app/desktop/src/renderer/src/harnesses/<id>/`, registered once from `workbench/activities.ts` and reached only through the footer slots (`footerSlot`); views never import it.
- Docs and tasks: markdown in git is the source of truth; the app edits the files, never a copy beside them.

## Releases and docs

- Every user-facing change gets an entry in `CHANGELOG.md` (Keep a Changelog format) under "Unreleased". Entries under "Unreleased" describe the end state: edit an existing entry in place, never add a "no longer" or "Changed" line for unreleased work. Tags per milestone; the CLI is published to PyPI from the sandbox core loop on.
- Every error message says what went wrong and what to do next; spec errors point to the file and line.
- New commands and spec fields get docs in `docs/` in the same change.
- Spec fields are added within `version: 1`, never renamed.

## Sandbox and index conventions

- Python, managed with uv. CLI with Typer, spec models with Pydantic, templates with Jinja2, YAML with ruamel.yaml, tests with pytest.
- Keep rendering pure (`python/src/wombat/render/`, spec → files) and separate from executing (`vm.py`, subprocess calls).
- Every VM operation goes through `vm.py`. Never assume host paths, shells or SSH config locations.
- All git access goes through `credentials.py`; all secret handling through `python/src/wombat/secrets/`.
- Never import Ansible as a library; it only runs as a program inside the VM.
- Nothing generated may hardcode a project name, instance name, port or path.
- Everything in the VM runs as one user, `dev`, for now, but nothing may assume a single user.
- Rendered files get snapshot tests in `python/tests/render/`.

## Safety defaults

- The safe choice is the default and the shortest path; unsafe choices are explicit and warn every time.
- Secret values never appear in the spec, in files inside the repos, or in Wombat's output.
- Never write `.env` files into worktrees unless a component opts in with `env_file:`.
- Wombat never handles Claude credentials: no sign-in of its own, no copying or storing tokens. Each user logs in with the `claude` binary through Claude's own flow. Agents on the host never get `ANTHROPIC_API_KEY` (`harness/env.ts` drops it); an API key as a secret is for the sandbox only.

## Naming

- Package `wombat-dev`, command `wombat`, import package `wombat`.
- "The app" is the desktop app and its agent service together; "the core" is the sandbox and the index.
- A project's spec lives in its workspace repo on the host: `wombat.yml`, `wombat.local.yml`, `seeds/`, `scripts/`, and state and build output in `.wombat/`. Its docs and tasks live in a docs repo of their own.
- Hostnames `<component>.<instance>.<project>.localhost` for the host browser; components reach each other through generated env vars. Ports from 15000 in blocks of 100 per instance.
