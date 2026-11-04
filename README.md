# <img src="app/desktop/assets/brand/wombat-mark.svg" width="40" height="40" alt="" align="top"> Wombat

Wombat is an agentic development environment for multi-repo projects. It sandboxes the project in a VM so agents can work across all its repos without reaching your machine, and has an app for working with the agents.

## Status

Early. Milestone 1: the app (a desktop app and its agent service, running on the host).

## Run the app

From `app/`, with Node 24 or newer and pnpm 12 (the `packageManager` field in `app/package.json` pins the version):

```sh
pnpm install
pnpm --filter @wombat/desktop exec install-electron   # once after each install: Electron doesn't download its binary on install
pnpm --filter @wombat/desktop start                   # real use: the strict build
pnpm --filter @wombat/desktop dev                     # only for working on the UI: relaxed dev CSP
```

## Checks

From `app/`:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## License

Apache-2.0, see [LICENSE](LICENSE).

The Apache-2.0 license covers Wombat's own code. Dependencies keep their own licenses, which aren't all open source: the Claude Agent SDK, used through `claude-agent-acp`, is under Anthropic's terms. They're installed from their registries, not included in this repo.
