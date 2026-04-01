# Kleiber - Requirements Specification (Final)

| Field              | Value                                          |
|--------------------|-------------------------------------------------|
| **Project**        | Kleiber                                         |
| **Type**           | Greenfield                                      |
| **Version**        | Final 1 (refined from Draft 1)                  |
| **Date**           | 2026-04-01                                      |
| **Author**         | Requirements Refiner (assisted by Claude)       |
| **Source**          | `kleiber_1_requirements_draft.md`               |

---

## 1. Background

Agentic coding workflows rely on multiple CLI-based AI agents (Claude Code, Codex, OpenCode, Gemini CLI) working within project directories. Today these are managed manually across scattered terminal windows, with no unified way to orchestrate sessions, spawn sub-agents, or monitor work remotely.

The **coding-agent-pack** provides a portable set of 13 specialized agent roles (requirements-engineer, architect, task-planner, project-manager, etc.) with thin harness-specific wrappers for each CLI. Kleiber ships with a bundled copy of this pack and uses it to offer predefined agent roles.

---

## 2. Problem Statement

There is no unified desktop application that:
- Organizes agentic coding work by project
- Embeds terminal sessions for multiple agent CLIs in one interface
- Allows agents to spawn and communicate with other agent sessions programmatically
- Provides remote monitoring and interaction from mobile devices
- Enforces safety controls (yolo mode gating) across agent sessions

---

## 3. Goals

1. Provide a single Electron desktop application to manage agentic coding projects, sessions, and sub-sessions
2. Embed fully functional terminal emulators (xterm.js) for all supported agent CLIs
3. Enable agent-to-agent orchestration via a built-in MCP server with standardized tools using a hybrid stdio/IPC architecture
4. Allow configurable safety controls per session and per project (yolo mode on/off) with downward inheritance enforcement
5. Optionally expose an HTTP remote API with a mobile-friendly web UI for monitoring, interaction, and session creation
6. Support Linux, macOS, and Windows
7. Bundle the coding-agent-pack and manage its global installation on first launch

---

## 4. Non-Goals

- Kleiber is **not** a code editor or IDE -- it manages agent sessions, not files directly
- No built-in AI model hosting -- all intelligence comes from the agent CLIs
- No multi-user or team collaboration features (single-user only for v1)
- No cloud hosting or SaaS deployment -- runs locally on the user's machine
- No modification of the coding-agent-pack itself -- Kleiber consumes it as-is
- No session logging or terminal scrollback persistence -- terminal output is ephemeral
- No HTTPS termination -- the app serves HTTP only; the user may front it with a reverse proxy for TLS

---

## 5. Stakeholders

| Role             | Description                                    |
|------------------|------------------------------------------------|
| **Primary user** | Solo developer using multiple AI coding agents |
| **Developer**    | Builder(s) of Kleiber                          |

---

## 6. Current State

- Agent CLIs are installed and configured independently by the user
- The coding-agent-pack provides 13 specialized agent roles with wrappers for Claude Code, Codex, OpenCode, and Gemini CLI
- `agent_pack_config.yaml` defines allowed providers, model defaults per complexity tier, and harness adapter metadata (launch command, orchestration capability)
- No unified management UI exists; work is done across separate terminal windows

---

## 7. Proposed Scope

### 7.1 Supported Agent CLIs

All four harnesses from `agent_pack_config.yaml`:

| CLI          | Launch command | Orchestration support              |
|--------------|----------------|------------------------------------|
| Claude Code  | `claude`       | Native subagents + agent teams     |
| Codex        | `codex`        | Native subagents                   |
| OpenCode     | `opencode`     | Plugin or manual                   |
| Gemini CLI   | `gemini`       | Experimental subagents             |

### 7.2 Platform support

| Platform | Install script           |
|----------|--------------------------|
| Linux    | `install.sh`             |
| macOS    | `install_macos.sh`       |
| Windows  | `install.ps1`            |

### 7.3 Desktop framework

**Electron** -- chosen for mature terminal emulation (xterm.js), cross-platform support, and rich ecosystem.

---

## 8. Definitions

| Term              | Definition                                                                                                      |
|-------------------|-----------------------------------------------------------------------------------------------------------------|
| **Project**       | A named entity in Kleiber associated with an absolute directory path on disk. All sessions for that project run with that directory as their working directory. |
| **Session**       | A PTY-backed terminal process running inside the app. Can be plain (bare shell), agent (CLI launched directly), or agent+role (CLI launched with a coding-agent-pack role). |
| **Sub-session**   | A session spawned by an agent via MCP. It is a child of the spawning session in the hierarchy and inherits yolo restrictions from its parent. |
| **Yolo mode**     | A per-session boolean flag. When true, the agent CLI is launched with its auto-approve flag, skipping all permission prompts. |
| **MCP**           | Model Context Protocol. Kleiber exposes an MCP tool server that agents in sessions can call to orchestrate other sessions. |
| **Hybrid MCP**    | Kleiber's MCP architecture: a central orchestration service in the Electron main process, with per-session stdio MCP wrappers that proxy to it over IPC. |
| **coding-agent-pack** | A portable bundle of 13 specialized agent roles with harness-specific wrappers. Kleiber ships with a bundled copy. |

---

## 9. User Stories

### Coding-Agent-Pack Management

- **US-00**: As a user, on first launch Kleiber checks if the coding-agent-pack is globally installed. If not, it shows a warning banner with a one-click "Install globally" button that runs the correct OS-specific installer (`install.sh --mode global` on Linux, `install_macos.sh --mode global` on macOS, `install.ps1 --mode global` on Windows) from the bundled copy.

### Project Management

- **US-01**: As a user, I can create a new project by specifying a name and directory path. If the directory does not exist, Kleiber creates it.
- **US-02**: As a user, I can open an existing directory as a project to resume work with my agents.
- **US-03**: As a user, I can see all my projects in a sidebar and switch between them.
- **US-04**: As a user, I can remove a project from Kleiber without deleting the directory on disk.

### Session Management

- **US-05**: As a user, I can create a new terminal session within a project, choosing either a plain terminal (no agent) or a specific agent CLI.
- **US-06**: As a user, I can select a predefined agent role from the coding-agent-pack when creating a session (e.g., requirements-engineer, architect, task-planner).
- **US-07**: As a user, I can see all active and exited sessions for a project in a hierarchical tree: Project > Sessions > Sub-sessions.
- **US-08**: As a user, I can switch between sessions by clicking on them in the hierarchy view.
- **US-09**: As a user, I can terminate a running session or sub-session.
- **US-10**: As a user, I can rename sessions for easier identification.

### Terminal Emulation

- **US-11**: As a user, I get a fully functional terminal emulator per session supporting: text input/output, scrollback, ANSI color (256-color and truecolor), mouse events, clipboard copy/paste.
- **US-12**: As a user, I can arrange multiple session terminals as tabs or side-by-side split panes, and resize them.

### Agent-to-Agent Orchestration (MCP)

- **US-13**: As a user, I can disable the built-in MCP tools for a specific session if I do not want it to spawn or interact with other sessions.
- **US-14**: As an agent (via MCP), I can call `spawn_session` to create a new sub-session with a specified CLI, optional role, optional name, optional yolo flag, and optional working directory. The sub-session appears as a child in the hierarchy.
- **US-15**: As an agent (via MCP), I can call `send_to_session` to write text input into another session's terminal.
- **US-16**: As an agent (via MCP), I can call `read_session` to read recent output lines from another session, choosing between plain text (ANSI stripped) or raw output (ANSI preserved).
- **US-17**: As an agent (via MCP), I can call `list_sessions` to discover existing sessions in the current project with their metadata (id, name, cli, role, state, yolo).
- **US-18**: As an agent (via MCP), I can call `kill_session` to terminate a session.

### Yolo Mode Configuration

- **US-19**: As a user, I can set a project-level default for yolo mode (on or off) that applies to newly created sessions unless overridden.
- **US-20**: As a user, I can override the yolo flag per session at creation time.
- **US-21**: As a user, I can see a visual indicator (badge/icon/color) on sessions running in yolo mode.

### Notifications

- **US-22**: As a user, I receive an OS-level notification when an agent session exits (completes or crashes) while the app is not in the foreground.

### Remote Access

- **US-23**: As a user, I can enable/disable the remote access API from settings.
- **US-24**: As a user, I can configure a username and password for the remote API.
- **US-25**: As a user, I can see which port the remote API is bound to, and the app avoids port collisions automatically.
- **US-26**: As a remote user, I can access a mobile-friendly web interface that shows the session hierarchy and terminal output.
- **US-27**: As a remote user, I can send input to existing sessions from the web interface.
- **US-28**: As a remote user, I can create new sessions (plain or with agent/role) from the web interface.
- **US-29**: As a remote user, I **cannot** manage projects (create/remove/rename) from the web interface.

---

## 10. Functional Requirements

### FR-01: Project Management

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-01.1  | The app shall maintain a persistent list of projects, each with a unique name and an absolute directory path. | Yes |
| FR-01.2  | Creating a project shall create the directory on disk if it does not exist.                                | Yes |
| FR-01.3  | Removing a project from Kleiber shall not delete the directory on disk.                                   | Yes |
| FR-01.4  | The project list shall persist across app restarts.                                                       | Yes |
| FR-01.5  | Project names shall be unique within Kleiber. The app shall reject duplicate names.                       | Yes |

### FR-02: Session Lifecycle

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-02.1  | A session is a PTY-backed process with its working directory set to the project's directory path.          | Yes |
| FR-02.2  | Sessions have three types: **plain** (user's default shell), **agent** (CLI only), **agent+role** (CLI with a coding-agent-pack role). | Yes |
| FR-02.3  | Each session belongs to exactly one project.                                                              | Yes |
| FR-02.4  | Sub-sessions are sessions spawned via MCP. They appear as children of the spawning session in the hierarchy. | Yes |
| FR-02.5  | Sub-sessions can be nested to arbitrary depth (a sub-session can spawn further sub-sessions).              | Yes |
| FR-02.6  | When a session exits, its state changes to "exited" and its exit code is displayed. It remains in the tree until dismissed by the user. | Yes |
| FR-02.7  | Terminating a parent session shall also terminate all its descendant sub-sessions.                        | Yes |

### FR-03: Coding-Agent-Pack Integration

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-03.1  | Kleiber shall ship with a bundled copy of the coding-agent-pack.                                          | Yes |
| FR-03.2  | On startup, the app shall check whether the pack is globally installed by verifying the existence of `~/.agents/skills/requirements-engineer/` (Linux/macOS) or `$HOME\.agents\skills\requirements-engineer\` (Windows). | Yes |
| FR-03.3  | If not globally installed, the app shall show a persistent warning banner with an "Install globally" button. | Yes |
| FR-03.4  | The "Install globally" button shall run the bundled installer with `--mode global` using the OS-appropriate script: `install.sh` (Linux), `install_macos.sh` (macOS), `install.ps1` (Windows). | Yes |
| FR-03.5  | The app shall read the list of available agent roles by scanning `shared/.agents/skills/` in the bundled pack, excluding `project-spec-utils`. | Yes |
| FR-03.6  | When launching an agent+role session, the app shall invoke the CLI's launch command with the arguments required to activate the chosen role (the specific flags depend on the CLI and are defined in the harness adapter config). | Yes |
| FR-03.7  | The app shall read `agent_pack_config.yaml` from the project directory's `.agent_specs/` if present, and use it to determine which harnesses are enabled. If absent, all four harnesses are assumed enabled. | Yes |

### FR-04: Terminal Emulation

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-04.1  | The app shall embed xterm.js as the terminal emulator.                                                   | Yes |
| FR-04.2  | The terminal shall support: ANSI escape codes (SGR, cursor movement, screen clearing), 256-color, truecolor (24-bit), mouse events, clipboard integration (copy/paste), configurable font size, scrollback buffer (minimum 10,000 lines). | Yes |
| FR-04.3  | Each session shall have its own independent xterm.js instance.                                            | Yes |
| FR-04.4  | The user shall be able to view sessions as tabs or side-by-side split panes, and resize panes by dragging. | Yes |

### FR-05: Built-in MCP Server

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-05.1  | The app shall run a central MCP orchestration service in the Electron main process.                       | Yes |
| FR-05.2  | Each agent session shall receive a stdio-based MCP wrapper process that proxies tool calls to the central service over IPC (Node.js IPC or equivalent). | Yes |
| FR-05.3  | MCP tools shall be **enabled by default** on all agent sessions. The user can disable MCP per-session.    | Yes |
| FR-05.4  | Plain (non-agent) sessions shall not receive MCP tools.                                                   | Yes |
| FR-05.5  | The MCP server shall expose the following tools:                                                          | -- |

#### MCP Tool: `spawn_session`

| Parameter      | Type     | Required | Description                                                  |
|----------------|----------|----------|--------------------------------------------------------------|
| `cli`          | string   | Yes      | Agent CLI identifier (e.g., `claude`, `codex`, `opencode`, `gemini`) |
| `role`         | string   | No       | Coding-agent-pack role name (e.g., `requirements-engineer`)  |
| `name`         | string   | No       | Human-readable session name. Defaults to `{cli}:{role}` or `{cli}` |
| `yolo`         | boolean  | No       | Whether to launch in yolo mode. Default: project default     |
| `working_dir`  | string   | No       | Working directory override. Default: parent session's project dir |

**Returns**: `{ session_id: string, name: string, yolo: boolean }`

**Constraints**:
- If the calling session has `yolo=false`, the `yolo` parameter is forced to `false` regardless of the value provided (FR-06.5).
- The `cli` value must correspond to an enabled harness in the project's config. If disabled, return an error.
- The `role` value must match a known agent role from the coding-agent-pack. If unknown, return an error.

#### MCP Tool: `send_to_session`

| Parameter    | Type     | Required | Description                        |
|--------------|----------|----------|------------------------------------|
| `session_id` | string   | Yes      | Target session ID                  |
| `text`       | string   | Yes      | Text to write to the session's PTY |

**Returns**: `{ success: boolean }`

**Constraints**:
- The target session must exist and be in "running" state. If exited, return an error.

#### MCP Tool: `read_session`

| Parameter    | Type     | Required | Description                                         |
|--------------|----------|----------|-----------------------------------------------------|
| `session_id` | string   | Yes      | Target session ID                                   |
| `lines`      | integer  | No       | Number of recent lines to return. Default: 100. Max: 1000. |
| `format`     | string   | No       | `plain` (ANSI stripped) or `raw` (ANSI preserved). Default: `plain`. |

**Returns**: `{ output: string, line_count: integer, format: string }`

#### MCP Tool: `list_sessions`

| Parameter    | Type     | Required | Description                                              |
|--------------|----------|----------|----------------------------------------------------------|
| `project_id` | string   | No       | Project to list sessions for. Default: calling session's project. |

**Returns**: `{ sessions: [{ session_id, name, cli, role, state, yolo, parent_session_id }] }`

#### MCP Tool: `kill_session`

| Parameter    | Type     | Required | Description         |
|--------------|----------|----------|---------------------|
| `session_id` | string   | Yes      | Session to terminate |

**Returns**: `{ success: boolean }`

**Constraints**:
- Killing a session also kills all its descendant sub-sessions (FR-02.7).
- A session cannot kill itself.

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-05.6  | All MCP tool calls shall be scoped to the calling session's project. An agent cannot interact with sessions in other projects. | Yes |
| FR-05.7  | The MCP tool surface shall include a version identifier so agents can detect capabilities.                | Yes |

### FR-06: Yolo Mode

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-06.1  | Each session shall have a boolean `yolo` flag, set at creation time.                                      | Yes |
| FR-06.2  | When `yolo=true`, the agent CLI shall be launched with its auto-approve flag. Known flags: `--dangerously-skip-permissions` (Claude Code). Flags for other CLIs shall be configured in the harness adapter layer. | Yes |
| FR-06.3  | Each project shall have a configurable default yolo setting (default: `false`).                           | Yes |
| FR-06.4  | The yolo flag shall be visually indicated in the session tree (e.g., warning badge, color highlight).     | Yes |
| FR-06.5  | **Yolo inheritance**: a parent session with `yolo=false` shall force all descendant sub-sessions to `yolo=false`, regardless of the `yolo` parameter in `spawn_session`. The MCP response shall include the effective yolo value. | Yes |
| FR-06.6  | A parent session with `yolo=true` may spawn sub-sessions with either `yolo=true` or `yolo=false`.        | Yes |

### FR-07: Notifications

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-07.1  | The desktop app shall send an OS-level notification (via Electron `Notification` API) when an agent session exits while the app window is not focused. | Yes |
| FR-07.2  | The notification shall include the session name and exit status (success/failure/exit code).              | Yes |
| FR-07.3  | Notifications are desktop-only. The remote web UI does not send notifications.                            | Yes |

### FR-08: Remote Access API

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-08.1  | The app shall optionally start an HTTP server exposing a REST + WebSocket API.                            | Yes |
| FR-08.2  | The API shall be disabled by default and require explicit opt-in via settings.                            | Yes |
| FR-08.3  | Authentication shall use username + password. The app shall support both HTTP Basic Auth and a token-based flow (POST credentials, receive bearer token). | Yes |
| FR-08.4  | The app shall select a port automatically, avoiding collisions by probing for an available port starting from a preferred default (e.g., 9100). The chosen port shall be displayed in settings. | Yes |
| FR-08.5  | The app shall serve HTTP only. The user is responsible for TLS termination via a reverse proxy if desired. | Yes |
| FR-08.6  | The API shall support: listing projects (read-only), listing sessions/sub-sessions, streaming terminal output (WebSocket), sending input to a session, creating new sessions. | Yes |
| FR-08.7  | The API shall **not** support: creating, removing, or renaming projects.                                 | Yes |
| FR-08.8  | Credentials shall be stored securely using the OS keychain (via Electron `safeStorage` API), not in plaintext config files. | Yes |
| FR-08.9  | The API shall bind to `0.0.0.0` by default when enabled (since its purpose is remote access). The user can override the bind address in settings. | Yes |

### FR-09: Remote Web UI

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-09.1  | A mobile-friendly web interface shall be served by the same HTTP server as the API.                       | Yes |
| FR-09.2  | The web UI shall display the Project > Session > Sub-session hierarchy.                                   | Yes |
| FR-09.3  | The web UI shall render terminal output with ANSI color support.                                          | Yes |
| FR-09.4  | The web UI shall allow sending text input to sessions.                                                    | Yes |
| FR-09.5  | The web UI shall allow creating new sessions (plain, agent, or agent+role).                               | Yes |
| FR-09.6  | The web UI shall be responsive and usable on viewports as narrow as 320px (mobile-first layout).          | Yes |
| FR-09.7  | The web UI frontend shall support connecting over both HTTP and HTTPS (for when the user fronts the app with a TLS-terminating reverse proxy). | Yes |
| FR-09.8  | The web UI shall use relative URLs or auto-detect the protocol so it works behind both HTTP and HTTPS proxies without configuration. | Yes |

### FR-10: Hierarchical View

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-10.1  | Both desktop and web UI shall display a tree view: **Projects** > **Sessions** > **Sub-sessions**.        | Yes |
| FR-10.2  | The tree shall update in real-time as sessions are created, terminated, renamed, or dismissed.             | Yes |
| FR-10.3  | Each session node in the tree shall display: session name, session type (plain/agent/agent+role), agent CLI name (if applicable), agent role (if applicable), yolo indicator, state (running/exited with exit code). | Yes |

### FR-11: Persistence

| ID       | Requirement                                                                                              | Testable |
|----------|----------------------------------------------------------------------------------------------------------|----------|
| FR-11.1  | Project list, project-level settings (yolo default), and user preferences shall persist in a local data store. | Yes |
| FR-11.2  | Terminal scrollback shall **not** be persisted across app restarts.                                       | Yes |
| FR-11.3  | Remote access settings (enabled, port override, bind address) shall persist. Credentials are stored via FR-08.8. | Yes |
| FR-11.4  | Session state (running sessions) is **not** persisted. All sessions are lost on app restart.              | Yes |

---

## 11. Non-Functional Requirements

### NFR-01: Performance

| ID        | Requirement                                                                                  | Measurable |
|-----------|----------------------------------------------------------------------------------------------|------------|
| NFR-01.1  | The app shall handle at least 10 concurrent terminal sessions without frame drops below 30fps. | Yes |
| NFR-01.2  | Terminal rendering shall maintain 60fps for normal output rates (< 1000 lines/sec).           | Yes |
| NFR-01.3  | The remote API WebSocket shall stream terminal output with < 500ms latency on a local network. | Yes |
| NFR-01.4  | App startup to usable state shall be under 5 seconds on a modern machine.                    | Yes |

### NFR-02: Security

| ID        | Requirement                                                                                  | Measurable |
|-----------|----------------------------------------------------------------------------------------------|------------|
| NFR-02.1  | Remote API credentials shall be stored using Electron `safeStorage` (OS keychain).            | Yes |
| NFR-02.2  | Yolo mode inheritance (FR-06.5) shall not be bypassable via MCP -- the central orchestration service enforces it, not the stdio wrapper. | Yes |
| NFR-02.3  | The app shall not expose PTY access beyond sessions the user or an authorized agent explicitly creates. | Yes |
| NFR-02.4  | MCP tool calls shall be project-scoped (FR-05.6) -- no cross-project session access.         | Yes |

### NFR-03: Reliability

| ID        | Requirement                                                                                  | Measurable |
|-----------|----------------------------------------------------------------------------------------------|------------|
| NFR-03.1  | If a session's PTY process crashes, the app shall detect it within 1 second and update the session state to "exited" with the exit code or signal. | Yes |
| NFR-03.2  | If an agent CLI is not installed (not found on PATH), the app shall show an error message in the session tree and not crash. | Yes |
| NFR-03.3  | The MCP central service crashing shall not crash the Electron app. The app shall log the error and surface a user-visible error state. | Yes |

### NFR-04: Usability

| ID        | Requirement                                                                                  | Measurable |
|-----------|----------------------------------------------------------------------------------------------|------------|
| NFR-04.1  | First-time setup requires only: (1) having at least one agent CLI on PATH, (2) clicking "Install globally" for the agent pack if not already installed. | Yes |
| NFR-04.2  | The app shall default to a dark theme.                                                        | Yes |
| NFR-04.3  | A keyboard shortcut (configurable) shall open a quick-launch dialog for creating new sessions. | Yes |

### NFR-05: Extensibility

| ID        | Requirement                                                                                  | Measurable |
|-----------|----------------------------------------------------------------------------------------------|------------|
| NFR-05.1  | Adding support for a new agent CLI shall require only adding an entry to the harness adapter configuration (launch command, yolo flag, MCP injection method). No code changes required. | Yes |
| NFR-05.2  | The MCP tool surface shall include a version number in its capabilities response.             | Yes |

---

## 12. Data & Integrations

| Integration            | Direction  | Details                                                                                      |
|------------------------|------------|----------------------------------------------------------------------------------------------|
| coding-agent-pack      | Bundled    | Shipped inside the Electron app. Used to read available roles and run the global installer.   |
| Agent CLIs             | Exec       | Spawned as PTY processes. Must be on the user's PATH.                                        |
| MCP Protocol           | Serve      | Kleiber provides a hybrid stdio/IPC MCP server per agent session.                            |
| File system            | Read/Write | Project directories, local data store for persistence.                                       |
| OS keychain            | Read/Write | Credential storage for remote API via Electron `safeStorage`.                                |
| OS notifications       | Write      | Desktop notifications for session exit events.                                               |
| Network                | Serve      | Optional HTTP server for remote API + web UI.                                                |

---

## 13. UX Requirements (High-Level)

- **Desktop layout**: Sidebar with project/session tree + main area with terminal pane(s)
- **Session tabs or split panes**: User can arrange multiple terminals in tabs or side-by-side
- **Quick-launch**: Configurable keyboard shortcut to open session creation dialog
- **Status bar**: Active session count, remote API status (on/off, port), yolo warning count
- **Dark theme default**: Terminal-centric aesthetic
- **Yolo indicators**: Warning-colored badge or border on yolo sessions in both tree and terminal header
- **Mobile web**: List-based navigation, full-width terminal view, no split panes

---

## 14. Constraints

1. Must use Electron as the desktop framework
2. Must bundle the coding-agent-pack without forking or modifying it
3. Single-user only (no multi-tenancy)
4. Agent CLIs are pre-installed by the user; Kleiber does not install them (it only installs the agent pack)
5. HTTP only for remote API; no built-in TLS
6. No session logging or scrollback persistence

---

## 15. Risks

| Risk                                                     | Likelihood | Impact | Mitigation                                                        |
|----------------------------------------------------------|------------|--------|-------------------------------------------------------------------|
| Agent CLIs change their flags/API                        | Medium     | Medium | Abstract CLI invocation behind config-driven harness adapter layer |
| MCP spec evolves and breaks compatibility                | Medium     | High   | Pin MCP protocol version, version the tool surface (NFR-05.2)    |
| Electron memory usage with many terminals                | High       | Medium | Lazy-load xterm.js instances; dispose exited session terminals after timeout |
| Remote API security (exposed on 0.0.0.0)                 | Medium     | High   | Require credentials, rate limiting, user must opt-in explicitly   |
| xterm.js rendering issues with specific CLI outputs      | Low        | Low    | Test all four CLIs early; xterm.js is battle-tested               |
| Bundled agent pack becomes outdated                      | Medium     | Low    | Plan for a future mechanism to update the bundled pack            |

---

## 16. Acceptance Criteria

| ID     | Criterion                                                                                                   |
|--------|-------------------------------------------------------------------------------------------------------------|
| AC-01  | On a fresh install (Linux), the app launches, detects missing agent pack, shows warning. User clicks "Install globally", the pack is installed to `~/.agents/skills/`, `~/.claude/agents/`, etc. Warning disappears. |
| AC-02  | User creates a project "my-app" at `~/projects/my-app`. The directory is created if absent. The project appears in the sidebar. |
| AC-03  | User creates a Claude Code session with the `requirements-engineer` role. The terminal shows Claude Code launching with the role active. User can type and see output. |
| AC-04  | User creates sessions for all four CLIs (claude, codex, opencode, gemini) in the same project. All launch successfully. |
| AC-05  | An agent calls `spawn_session` via MCP with `cli=claude, role=architect`. A sub-session appears under the parent in the hierarchy. The agent can call `read_session` on it and receive output. |
| AC-06  | A session with `yolo=false` calls `spawn_session` with `yolo=true`. The resulting sub-session has `yolo=false` (forced). The MCP response confirms `yolo: false`. |
| AC-07  | User enables remote API. The app selects an available port and displays it. User opens the web UI from a phone browser, authenticates with username/password, sees the project tree, taps a session, and sees live terminal output. |
| AC-08  | Remote user creates a new Gemini CLI session with `architect` role from the mobile web UI. The session appears in both the web UI and the desktop app's tree. |
| AC-09  | User terminates a parent session that has two sub-sessions. All three sessions transition to "exited" state. |
| AC-10  | While the app is minimized, an agent session exits. An OS notification appears with the session name and exit code. |
| AC-11  | The app launches and runs correctly on Linux, macOS, and Windows. |

---

## 17. Assumptions

1. The user has at least one of the four supported agent CLIs installed and on their PATH.
2. The user's machine supports PTY allocation (standard on all three target platforms).
3. Electron bundles its own Node.js runtime; no separate Node.js installation is required.
4. Network access for the remote API (port forwarding, firewall rules) is the user's responsibility.
5. All four supported agent CLIs (Claude Code, Codex, OpenCode, Gemini CLI) accept a stdio-based MCP server configuration. Kleiber injects the per-session wrapper using the CLI's native configuration mechanism so MCP tools remain available across all supported harnesses.

---

## 18. Decisions Made During Refinement

| Decision | Rationale |
|----------|-----------|
| Coding-agent-pack is bundled inside the app | Ensures zero-config first run. User does not need to locate or download the pack separately. |
| Hybrid MCP transport (stdio wrappers + central IPC service) | Maximizes agent CLI compatibility (all support stdio) while enabling cross-session tools via shared state. |
| No session logging | Explicitly out of scope for v1 to reduce complexity. |
| HTTP only, no TLS | Keeps the app simple. TLS is the user's responsibility via reverse proxy. |
| OS notifications on desktop only, not on remote web | Desktop has mature notification APIs. Web push notifications add significant complexity for v1. |
| `read_session` supports both `plain` and `raw` format | Gives agents flexibility -- plain for parsing, raw for faithful reproduction. |
| MCP enabled by default on agent sessions | Reduces friction. The main value of Kleiber is orchestration; opt-out is sufficient. |
| Remote API binds to 0.0.0.0 by default when enabled | The entire purpose of enabling the API is remote access; binding to localhost would defeat that. |
| Port auto-selection with collision avoidance | Prevents conflicts with other services on the user's machine. |
| Global install detection via `~/.agents/skills/requirements-engineer/` | This directory is created by `install.sh --mode global` and is the canonical marker for all platforms. |

---

## 19. Change Summary

| Version                | Date       | Changes                                                                                         |
|------------------------|------------|--------------------------------------------------------------------------------------------------|
| Draft 1                | 2026-03-31 | Initial draft                                                                                    |
| Final 1 (this document)| 2026-04-01 | Resolved all 5 open questions. Added definitions section. Made all FRs testable with IDs. Added MCP tool schemas with parameters, returns, and constraints. Added FR-03 agent-pack bundling and install detection. Specified hybrid MCP architecture. Added notifications (FR-07). Clarified port auto-selection and bind address. Added `format` parameter to `read_session`. Added yolo inheritance direction rules. Specified cascade termination. Added sub-session nesting depth. Added NFR measurability. Added 3 new acceptance criteria (AC-09, AC-10, AC-11). Documented all decisions made during refinement. |
