# Kleiber
> [!WARNING]  
> This project is still in development, expect bugs

Kleiber is a cross-platform control room for serious agentic development: a simpler, more transparent alternative to bloated harness-native ecosystems.

It combines:

- project-scoped terminal sessions
- harness-backed agent sessions for `codex`, `claude`, `opencode`, and `gemini`
- the bundled `kleiber-agents` role ecosystem
- a built-in MCP orchestration server for agent-to-agent session control
- an optional remote API and browser client for session access on the go

## What Kleiber Is For

Most agent CLIs are great at single-session work, but they break down once you want a real team workflow. On the other side, some harness-native ecosystems try to own the whole engineering process and become opaque, over-automated, and heavy.

Kleiber sits in the middle: simple where it should be, powerful where it matters.

It gives you a shared, project-scoped environment where agents can work like a team across supported harnesses, while still making that teamwork visible and controllable. Agents launched through Kleiber know they are part of the same ecosystem, know what other roles exist, and can use Kleiber's orchestration layer to delegate, coordinate, and even spawn work across different harnesses when that is the right move.

The point is not to force a full automatic pipeline every time. Kleiber lets you decide how much autonomy to hand over:

- stay fully manual with plain terminals and focused agent sessions
- run role-based specialists when you want structure
- let agents collaborate and orchestrate other agents when you want leverage
- keep control over the process instead of handing everything to a black box

The bundled `kleiber-agents` pack adds reusable software-delivery roles so you can spin up targeted specialists such as:

- `requirements-engineer`
- `architect`
- `task-planner`
- `project-manager`
- `documentation-writer`
- `test-engineer`
- `security-reviewer`

## Main Features

- Desktop app built with Electron, React, and TypeScript
- Plain terminal sessions and harness-backed agent sessions
- Agent-role sessions that launch a CLI harness with a selected `kleiber-agents` role
- Project > session > sub-session hierarchy
- Optional YOLO mode for agent sessions when the selected harness supports it
- Bundled MCP server for spawning, listing, reading, messaging, and killing related sessions
- Optional remote API with browser client and terminal streaming over WebSocket
- Secure storage for remote API credentials through Electron `safeStorage`
- Built-in detection for installed agent CLIs on your `PATH`
- Global `kleiber-agents` installation from the desktop app or bundled install scripts
- Pack compatibility alias for the legacy `coding-agent-pack` name during the transition period

## Core Concepts

### Project

A saved project points Kleiber at a working directory on disk. Sessions created inside that project inherit that directory by default.

### Session Types

Kleiber currently supports three session modes:

- `plain`: a normal terminal
- `agent`: a terminal launched with an agent CLI such as `codex` or `claude`
- `agent_role`: a harness launch plus a bundled role from `kleiber-agents`

### Sub-sessions

Sessions can be nested. This is useful when one terminal or agent needs a focused child task without losing the parent context.

### `kleiber-agents`

`kleiber-agents` is Kleiber's bundled role system. It contains canonical role definitions plus thin harness-specific wrappers for Codex, Claude Code, OpenCode, and Gemini CLI.

The legacy name `coding-agent-pack` is still recognized as a compatibility alias for one release cycle, but new docs and runtime behavior use `kleiber-agents` as the primary name.

### MCP Orchestration

When MCP is enabled for an agent session, Kleiber injects a session-scoped stdio bridge so the agent can talk to the built-in Kleiber MCP server. The current tool surface is centered on:

- `spawn_session`
- `send_to_session`
- `read_session`
- `list_sessions`
- `kill_session`

## How It Works

Kleiber uses a multi-process architecture:

1. The Electron main process owns session lifecycle, persistence, the bundled MCP orchestrator, and the optional remote API server.
2. The desktop renderer shows projects, sessions, settings, and xterm.js-backed terminal panes.
3. Agent sessions are launched through configured harness adapters for Codex, Claude Code, OpenCode, or Gemini CLI.
4. When MCP is enabled, Kleiber injects a per-session stdio wrapper so the harness can talk to the main-process orchestrator.
5. The optional web client is built separately and served by the same Fastify server that exposes the remote API.

In practice, the flow looks like this:

- You create or register a project directory.
- You open a plain terminal, a harness session, or a harness-plus-role session.
- Kleiber launches the process inside the project directory.
- Output is streamed to the desktop UI and, when enabled, to the remote web client.
- Agent sessions can collaborate through Kleiber MCP instead of operating as isolated shells.

## Installation

### Requirements

- Node.js 22+ recommended for local development
- `pnpm` 9.x via Corepack
- One or more supported agent CLIs on your `PATH` if you want harness sessions:
  - `codex`
  - `claude`
  - `opencode`
  - `gemini`

Desktop packaging targets currently include:

- Linux x64 (`AppImage`, `deb`)
- macOS (`dmg`, Intel and Apple Silicon)
- Windows x64 (`nsis`)

### Run From Source

```bash
corepack enable
pnpm install
pnpm dev
```

Useful development commands:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:package
```

Platform-specific packaging commands are also available:

```bash
pnpm build:linux
pnpm build:mac
pnpm build:win
```

### Install `kleiber-agents` Globally

Kleiber bundles `kleiber-agents` inside the app distribution, but it can also install the pack into user-global harness locations for better harness-native discovery outside a Kleiber-launched session.

From this repository:

```bash
bash kleiber-agents/install.sh --mode global
```

On macOS:

```bash
bash kleiber-agents/install_macos.sh --mode global
```

You can also trigger the same global installation from the desktop app through the banner or Settings > `Pack & Updates`.

For pack-specific details, see [`kleiber-agents/README.md`](./kleiber-agents/README.md).

## First Use

1. Launch Kleiber.
2. Create a project and choose the working directory.
3. Open a new session.
4. Pick one of the three session types: plain terminal, harness, or harness + agent.
5. If you choose a harness session, select an installed CLI.
6. If you choose a role session, select one of the bundled `kleiber-agents` roles.
7. Enable YOLO mode only when you want the selected harness to run with its more permissive flag set.

Default desktop shortcuts include:

- `CmdOrCtrl+N`: new project
- `CmdOrCtrl+T`: new session
- `CmdOrCtrl+Shift+T`: new sub-session
- `CmdOrCtrl+W`: kill session
- `CmdOrCtrl+,`: open settings

## Using Kleiber

### Desktop Workflow

The desktop app is the full control surface.

You can:

- create and rename projects
- create top-level sessions and sub-sessions
- switch between overview and terminal tabs
- kill or delete sessions
- inspect CLI availability
- manage `kleiber-agents` installation status
- configure the remote API

Kleiber shows session state directly in the UI:

- `starting`
- `running`
- `exited`

If a session exits while no Kleiber window is focused, the app can raise a desktop notification.

### Choosing the Right Session Type

- Use `plain` when you just need a shell in the project directory.
- Use `agent` when you want a harness CLI without a predefined role.
- Use `agent_role` when you want the harness to start with a specific Kleiber role such as `documentation-writer` or `task-planner`.

### Remote API And Web Client

Kleiber can expose a local HTTP and WebSocket server for remote access.

The desktop app lets you:

- enable or disable the remote API
- choose a fixed port or allow auto-assignment starting at `9100`
- set the bind address
- store a username and password securely through Electron `safeStorage`

Recommended local-only configuration:

- bind address: `127.0.0.1`
- set a username and password before connecting

Once enabled, the remote server provides:

- `POST /auth` for login
- `GET /projects`
- `GET /projects/:projectId/session-options`
- `GET /projects/:projectId/sessions`
- `POST /projects/:projectId/sessions`
- `POST /projects/:projectId/sessions/:sessionId/kill`
- `DELETE /projects/:projectId/sessions/:sessionId`
- `POST /projects/:projectId/sessions/:sessionId/resize`
- WebSocket terminal input and output routes under `/ws/sessions/...`

The remote web UI is served by the same server. After logging in, it can:

- list projects
- browse session trees
- create sessions
- stream terminal output
- send terminal input
- kill or delete sessions

The desktop app remains the primary place for project creation, global pack management, and application settings.

## Bundled Roles

The repository currently bundles these canonical roles:

- `requirements-engineer`
- `brainstormer`
- `requirements-refiner`
- `architect`
- `security-analyst`
- `ui-ux-designer`
- `task-planner`
- `project-manager`
- `documentation-writer`
- `specification-reviewer`
- `security-reviewer`
- `test-engineer`
- `field-tester`

These are discovered from the bundled `kleiber-agents` skill tree and surfaced in session creation flows.

## Repository Layout

```text
.
├── kleiber-agents/        # bundled role system, wrappers, installers
├── packages/
│   ├── main/              # Electron main process, sessions, MCP, remote API
│   ├── preload/           # contextBridge API exposed to the renderer
│   ├── renderer/          # desktop React UI
│   ├── shared/            # shared types and constants
│   └── web/               # remote browser client
├── e2e/                   # Playwright tests
```


## Additional Documentation

- [`kleiber-agents/README.md`](./kleiber-agents/README.md): bundled role pack, installers, wrapper layout, and output artifacts
- [`COMMERCIAL_LICENSE.md`](./COMMERCIAL_LICENSE.md): plain-English summary of when a separate commercial license is required
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): inbound contribution terms for this licensing model

## License

Kleiber is source-available under [`BUSL-1.1`](./LICENSE).

In practical terms, you can use, modify, and run it for personal work, internal business
operations, consulting, client services, education, research, and integrations without a
separate agreement, as long as you are not monetizing Kleiber itself.

If you want to sell Kleiber, offer it as a hosted or managed service, white-label or OEM
it, or ship a paid product whose primary value substantially comes from Kleiber, you need
a separate commercial license. See [`COMMERCIAL_LICENSE.md`](./COMMERCIAL_LICENSE.md).
