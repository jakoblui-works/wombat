# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The app scaffold: a pnpm workspace with shared types, the agent service and the desktop app.
- An agent service skeleton.
- A desktop app skeleton with secure defaults: context isolation on, no Node in the renderer, a strict content security policy.
- CI that lints, type-checks, tests, builds and runs the desktop end-to-end tests on every push and pull request.
- The Wombat logo: a mark and a symbol, in colour and in one colour, in `app/desktop/assets/brand/`; the mark heads the README.

### Changed

- The app needs Node 26 or newer (was 24).
