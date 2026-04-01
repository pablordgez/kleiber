# Kleiber — Execution Plan

| Field              | Value                                          |
|--------------------|-------------------------------------------------|
| **Project**        | Kleiber                                         |
| **Version**        | 1                                               |
| **Date**           | 2026-04-01                                      |
| **Author**         | Task Planner (assisted by Claude)               |
| **Sources**        | `kleiber_1_requirements_final.md`, `kleiber_1_architecture.yaml`, `kleiber_1_security_plan.md`, `kleiber_1_UIUX.md`, `agent_pack_config.yaml` |
| **Methodology**    | Agile — iterative milestones, maximize task parallelism |

---

## Provider & Model Strategy

| Use Case | Recommended Model | Provider | Effort | Rationale |
|----------|-------------------|----------|--------|-----------|
| Heavy frontend — creating shell/scaffold | Gemini 3.1 Pro | Google | — | Best for large initial UI generation |
| Frontend heavy — building on existing UI | Sonnet 4.6 | Anthropic | — | Strong at iterating on established React components |
| Frontend light / well-established views | GPT 5.4 mini | OpenAI | low-medium | Cost-effective for scoped UI edits |
| Backend — complex (MCP, security) | GPT 5.4 | OpenAI | high | Strong reasoning for backend architecture |
| Backend — moderate (API routes, services) | GPT 5.3 codex | OpenAI | medium | Good balance for standard backend work |
| Backend — simple (config, types, utils) | GPT 5.4 mini | OpenAI | low | Mechanical tasks, well-scoped |
| Testing | GPT 5.3 codex | OpenAI | medium | Test writing is well-scoped, formulaic |
| Integration / wiring | Sonnet 4.6 | Anthropic | — | Good at cross-cutting concerns |

**Constraint:** No `xhigh` effort level on any OpenAI model.

---

## Milestone Overview

| Milestone | Name | Goal | Dependencies |
|-----------|------|------|-------------|
| **M0** | Project Scaffold | Monorepo, build tooling, shared types, CI skeleton | None |
| **M1** | Core Backend | Session manager, persistence, PTY, agent pack manager | M0 |
| **M2** | Desktop Shell | Electron window, sidebar, terminal pane, IPC bridge | M0 |
| **M3** | Desktop Integration | Wire backend ↔ UI, session CRUD, terminal I/O | M1, M2 |
| **M4** | MCP Orchestration | Central orchestrator, stdio wrappers, all 5 MCP tools | M1 |
| **M5** | Yolo & Safety | Yolo inheritance, session limits, depth limits, notifications | M3, M4 |
| **M6** | Remote API | Fastify server, REST + WebSocket, auth, rate limiting | M1 |
| **M7** | Remote Web UI | Mobile-friendly React SPA, terminal streaming | M6 |
| **M8** | Polish & Packaging | Settings panel, electron-builder, platform testing | M5, M6, M7 |

---

## M0 — Project Scaffold

All tasks in M0 can run in parallel.

### T-001: Initialize monorepo with pnpm workspaces

- **Objective:** Create the pnpm workspace monorepo structure with all 5 packages (`main`, `renderer`, `preload`, `web`, `shared`)
- **Deliverables:** `pnpm-workspace.yaml`, `package.json` (root + each package), `tsconfig.json` (root + each package with project references), `.gitignore`, `.prettierrc`, `.eslintrc`
- **Traceability:** Architecture → `monorepo_layout`
- **Complexity:** Low
- **Dependencies:** None
- **Parallel with:** T-002, T-003
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** `pnpm install` succeeds; `pnpm -r exec echo ok` prints ok for all 5 packages

### T-002: Configure electron-vite build

- **Objective:** Set up `electron-vite` config for main, renderer, and preload. Configure Vite for the web package (separate build target).
- **Deliverables:** `electron.vite.config.ts`, `packages/web/vite.config.ts`, dev script (`pnpm dev`) launches Electron with HMR
- **Traceability:** Architecture → `stack.build_and_tooling`
- **Complexity:** Medium
- **Dependencies:** T-001 (needs workspace structure)
- **Parallel with:** T-003 (after T-001)
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** `pnpm dev` starts Electron with an empty window; `pnpm build` produces output in `dist/`

### T-003: Define shared TypeScript types

- **Objective:** Create all shared types and constants in `packages/shared`: `Project`, `Session`, `SessionRecord`, `AppSettings`, `RemoteApiCredentials`, MCP tool schemas, IPC channel names, harness adapter types
- **Deliverables:** `packages/shared/src/types.ts`, `packages/shared/src/constants.ts`, `packages/shared/src/ipc-channels.ts`
- **Traceability:** Architecture → `data_modeling`, FR-01 through FR-09
- **Complexity:** Low
- **Dependencies:** None
- **Parallel with:** T-001, T-002
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** Types compile with `tsc --noEmit`; all fields from architecture `data_modeling` section are represented

### T-004: Bundle coding-agent-pack as extraResources

- **Objective:** Copy the `coding-agent-pack/` directory into the Electron build as `extraResources`. Set up electron-builder config for this.
- **Deliverables:** `electron-builder.yml` (or equivalent config), verified that the pack appears in the built app's resources directory
- **Traceability:** FR-03.1, Architecture → `integrations.coding_agent_pack`
- **Complexity:** Low
- **Dependencies:** T-002
- **Parallel with:** T-003
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** `pnpm build` includes `coding-agent-pack/` in output resources

---

## M1 — Core Backend

Tasks T-005 through T-009 can mostly run in parallel (they share only `packages/shared` types).

### T-005: Implement PersistenceStore

- **Objective:** Create `src/main/store/` with electron-store for project list, app settings, and schema versioning. Implement safeStorage wrapper for credentials.
- **Deliverables:** `packages/main/src/store/persistence.ts`, `packages/main/src/store/credentials.ts`
- **Traceability:** FR-01.4, FR-11.1, FR-11.3, FR-08.8, Security Plan §3.4
- **Complexity:** Medium
- **Dependencies:** T-003
- **Parallel with:** T-006, T-007, T-008, T-009
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** Unit tests: create/read/update/delete projects; credentials encrypt/decrypt round-trip; settings persist across store reload

### T-006: Implement SessionManager (PTY lifecycle)

- **Objective:** Create `src/main/sessions/` with the in-memory session registry, PTY spawn (node-pty), resize, kill, cascade-kill, state transitions, output circular buffer, and event emission.
- **Deliverables:** `packages/main/src/sessions/session-manager.ts`, `packages/main/src/sessions/circular-buffer.ts`
- **Traceability:** FR-02.1–FR-02.7, FR-06.1–FR-06.6, NFR-01.1, Security Plan §3.2
- **Complexity:** High
- **Dependencies:** T-003
- **Parallel with:** T-005, T-007, T-008, T-009
- **Model:** GPT 5.4 (OpenAI, high effort)
- **Model notes:** Complex state management with PTY processes, cascade termination, yolo inheritance — needs strong reasoning
- **Agent type:** general-purpose
- **Validation:** Unit tests: spawn session → state=running; kill parent → all descendants killed; circular buffer evicts oldest; yolo=false parent forces child yolo=false; exit detection within 1s

### T-007: Implement AgentPackManager

- **Objective:** Create `src/main/pack/` with global install detection, installer execution, role discovery (scan skills directories), and agent_pack_config.yaml parsing.
- **Deliverables:** `packages/main/src/pack/agent-pack-manager.ts`
- **Traceability:** FR-03.1–FR-03.7, Architecture → `integrations.coding_agent_pack`
- **Complexity:** Medium
- **Dependencies:** T-003
- **Parallel with:** T-005, T-006, T-008, T-009
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** Unit tests: detect installed pack; list roles (13 minus project-spec-utils = 13 roles); parse config YAML; installer invocation uses array-form spawn (no shell injection)

### T-008: Implement harness adapter layer

- **Objective:** Create the config-driven harness adapter that maps CLI identifiers to launch commands, yolo flags, and MCP injection methods. Read from agent_pack_config.yaml. Support adding new CLIs via config only (NFR-05.1).
- **Deliverables:** `packages/main/src/pack/harness-adapter.ts`
- **Traceability:** NFR-05.1, FR-06.2, Architecture → `integrations.agent_clis`
- **Complexity:** Low
- **Dependencies:** T-003
- **Parallel with:** T-005, T-006, T-007, T-009
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** Unit tests: resolve launch command + yolo flag for each of the 4 CLIs; unknown CLI returns error; adding a new entry to config adds a new CLI without code changes

### T-009: Set up electron-log

- **Objective:** Configure `electron-log` in main process with rotation (5MB, 3 files), log levels, and security-relevant event templates per Security Plan §6.
- **Deliverables:** `packages/main/src/logging.ts`
- **Traceability:** Architecture → `observability.logging`, Security Plan §6
- **Complexity:** Low
- **Dependencies:** T-001
- **Parallel with:** T-005, T-006, T-007, T-008
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** Log file created in userData directory; rotation works; log entries include timestamp and level

---

## M2 — Desktop Shell

M2 can run **fully in parallel** with M1 (different packages).

### T-010: Create Electron main entry + BrowserWindow with security hardening

- **Objective:** Create the Electron main process entry point with BrowserWindow configured per Security Plan §3.5: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, CSP headers, navigation restrictions, permission denials.
- **Deliverables:** `packages/main/src/index.ts` (or `main.ts`), window creation with all security options
- **Traceability:** Security Plan §3.5, NFR-04.2
- **Complexity:** Medium
- **Dependencies:** T-002
- **Parallel with:** T-011, T-012
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** App launches with DevTools confirming: CSP active, nodeIntegration off, contextIsolation on

### T-011: Build desktop UI shell — sidebar + content area + status elements

- **Objective:** Create the complete desktop UI shell in `packages/renderer`: the top-level layout (sidebar 240px + content area), the sidebar component with project/session/sub-session tree (arbitrary depth, indent cap at level 6, dotted border beyond), session header bar with breadcrumb, status dots, yolo badges, empty states, new project/session dialogs, project overview panel. Use shadcn/ui components, Tailwind CSS, Zustand store with slices for projects/sessions/ui/settings. Follow UIUX spec §3–§8 exactly (monochrome palette, Inter font, no shadows, 32px row height, etc.).
- **Deliverables:**
  - `packages/renderer/src/App.tsx` — shell layout
  - `packages/renderer/src/components/Sidebar/` — `ProjectSidebar.tsx`, `SidebarItem.tsx`
  - `packages/renderer/src/components/Terminal/` — `TerminalPane.tsx` (placeholder), `SessionHeader.tsx`
  - `packages/renderer/src/components/Dialogs/` — `NewProjectDialog.tsx`, `NewSessionDialog.tsx`
  - `packages/renderer/src/components/ProjectOverview.tsx`
  - `packages/renderer/src/components/StatusBar.tsx`
  - `packages/renderer/src/store/` — Zustand slices
  - Tailwind config with UIUX palette, Inter + JetBrains Mono fonts
- **Traceability:** UIUX §3–§8, FR-10.1–FR-10.3, US-03, US-07, US-08, US-10, US-12
- **Complexity:** High (this is the heavy frontend scaffold)
- **Dependencies:** T-002, T-003
- **Parallel with:** T-010, T-012, all of M1
- **Model:** Gemini 3.1 Pro (Google)
- **Model notes:** Heavy initial frontend creation — Gemini 3.1 Pro recommended for generating the full shell scaffold with many components in one pass
- **Agent type:** general-purpose
- **Validation:** App renders sidebar with mock data (projects, sessions at various depths); dialogs open/close; correct colors, fonts, spacing per UIUX spec; dark theme active by default

### T-012: Create preload / IPC bridge

- **Objective:** Create preload scripts exposing `window.kleiber` namespace via contextBridge with typed invoke/on wrappers for: projects, sessions, terminals, settings, pack. Create main-side IPC handler registration.
- **Deliverables:** `packages/preload/src/index.ts`, `packages/main/src/ipc/handlers.ts`, `packages/shared/src/ipc-channels.ts` (extend from T-003)
- **Traceability:** Architecture → `preload_scripts`, `IpcBridge`, Security Plan §3.5
- **Complexity:** Medium
- **Dependencies:** T-003
- **Parallel with:** T-010, T-011
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** Renderer can call `window.kleiber.projects.list()` and receive data from main process; TypeScript types enforce the API contract

---

## M3 — Desktop Integration

M3 wires M1 backend to M2 frontend.

### T-013: Wire project CRUD through IPC

- **Objective:** Connect the renderer's project sidebar and dialogs to the main process PersistenceStore via IPC. Create project, list projects, remove project (without deleting directory), rename project. Validate project name uniqueness (FR-01.5).
- **Deliverables:** IPC handler implementations in `packages/main/src/ipc/`, Zustand actions in renderer calling `window.kleiber.projects.*`
- **Traceability:** FR-01.1–FR-01.5, US-01–US-04
- **Complexity:** Medium
- **Dependencies:** T-005, T-011, T-012
- **Parallel with:** T-014
- **Model:** Sonnet 4.6 (Anthropic)
- **Model notes:** Cross-cutting wiring between existing backend and frontend — Sonnet good at this
- **Agent type:** general-purpose
- **Validation:** Create a project → appears in sidebar → persists across app restart → remove → gone from sidebar but directory still on disk

### T-014: Wire session lifecycle through IPC + integrate xterm.js

- **Objective:** Connect session creation/termination/switching to SessionManager via IPC. Integrate real xterm.js instances in TerminalPane: spawn PTY in main, stream output via IPC to xterm.js, stream input from xterm.js back to PTY. Implement lazy xterm.js initialization (only active pane). Implement session rename (US-10). Handle CLI-not-found errors gracefully (NFR-03.2).
- **Deliverables:** Updated `TerminalPane.tsx` with real xterm.js, IPC terminal data channels, session creation flow with CLI + role selection
- **Traceability:** FR-02.1–FR-02.7, FR-04.1–FR-04.4, US-05–US-12, NFR-01.1–NFR-01.2, NFR-03.2
- **Complexity:** High
- **Dependencies:** T-006, T-011, T-012
- **Parallel with:** T-013
- **Model:** Sonnet 4.6 (Anthropic)
- **Model notes:** Complex integration — terminal streaming, lazy loading, state sync across processes
- **Agent type:** general-purpose
- **Validation:** Create a plain terminal session → type commands → see output; create a claude session → agent launches; kill session → state=exited in sidebar; 10 concurrent sessions without UI lag; CLI not on PATH → error message, no crash

---

## M4 — MCP Orchestration

M4 can run in parallel with M3 (backend-only, no UI dependency).

### T-015: Implement McpOrchestrator (central service)

- **Objective:** Create `src/main/mcp/orchestrator.ts` — the central MCP orchestration service in the main process. Implement all 5 tool handlers: `spawn_session`, `send_to_session`, `read_session`, `list_sessions`, `kill_session`. Enforce: yolo inheritance (Security Plan §3.2), project scoping (§3.3), session limits (50/project), depth limits (10 levels), spawn rate limiting (5/min/session). Validate all parameters with JSON Schema. Include MCP version identifier.
- **Deliverables:** `packages/main/src/mcp/orchestrator.ts`, `packages/main/src/mcp/schemas.ts` (JSON Schema for each tool)
- **Traceability:** FR-05.1–FR-05.7, FR-06.5–FR-06.6, Security Plan §3.2, §3.3, §4.5, §4.6, NFR-02.2, NFR-02.4, NFR-05.2
- **Complexity:** High
- **Dependencies:** T-006 (SessionManager)
- **Parallel with:** T-016
- **Model:** GPT 5.4 (OpenAI, high effort)
- **Model notes:** Security-critical code with complex validation rules — needs strongest reasoning
- **Agent type:** general-purpose
- **Validation:** Unit tests for every tool; yolo inheritance: false parent → spawn with yolo=true → effective false; project scoping: cross-project access → error; session limit: 51st spawn → error; depth 11 → error; rate limit: 6th spawn in 1 min → error

### T-016: Implement McpStdioWrapper

- **Objective:** Create `src/main/mcp/stdio-wrapper.ts` — standalone Node.js script launched by the agent CLI as a stdio MCP server. Implements MCP JSON-RPC protocol on stdin/stdout. Proxies all tool calls to McpOrchestrator via a per-session IPC socket. Receives `sessionId`, `projectId`, and socket path from environment variables. Has no direct PTY or session state access.
- **Deliverables:** `packages/main/src/mcp/stdio-wrapper.ts`
- **Traceability:** FR-05.2, Architecture → `mcp_stdio_wrappers`, Security Plan §4.3
- **Complexity:** Medium
- **Dependencies:** T-003 (shared types)
- **Parallel with:** T-015
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** Wrapper receives JSON-RPC on stdin → proxies via IPC → returns response on stdout; environment variables set correctly; no direct PTY access in code

### T-017: Integrate MCP wrapper launch into SessionManager

- **Objective:** When an agent session starts with MCP enabled, create a per-session IPC bridge in the main process and configure the agent CLI to launch the stdio wrapper as its MCP server via a CLI-specific mechanism. Pass `KLEIBER_SESSION_ID`, `KLEIBER_PROJECT_ID`, and `KLEIBER_MCP_SOCKET_PATH` as wrapper env vars. Allow disabling MCP per session (FR-05.3).
- **Deliverables:** Updates to `session-manager.ts`, harness adapter config for MCP injection per CLI
- **Traceability:** FR-05.2–FR-05.4, US-13, Architecture → `integrations.agent_clis.mcp_injection`
- **Complexity:** Medium
- **Dependencies:** T-015, T-016, T-006, T-008
- **Parallel with:** None (depends on both orchestrator and wrapper)
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** Create agent session → CLI receives wrapper config → wrapper connects to the main-process IPC bridge → agent can call `list_sessions`; plain session → no MCP bridge created; MCP disabled → no MCP wrapper config injected

---

## M5 — Yolo & Safety & Notifications

### T-018: Implement yolo mode UI indicators and project defaults

- **Objective:** Add yolo badge rendering in sidebar and session header per UIUX spec (orange `YOLO` badge). Wire project-level yolo default setting. Disable yolo toggle in New Session dialog when project yolo is off. Visual indicator per FR-06.4.
- **Deliverables:** Updated sidebar items, session header, new session dialog, project settings
- **Traceability:** FR-06.1–FR-06.4, US-19–US-21, UIUX §5.6
- **Complexity:** Low
- **Dependencies:** T-013, T-014
- **Parallel with:** T-019, T-020
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Model notes:** Well-established frontend at this point; scoped UI additions
- **Agent type:** general-purpose
- **Validation:** Yolo session shows orange badge in sidebar + header; project yolo=off → toggle disabled in dialog; visual indicators match UIUX spec

### T-019: Implement OS notifications for session exit

- **Objective:** Send Electron `Notification` when an agent session exits while the app window is not focused. Include session name and exit status.
- **Deliverables:** `packages/main/src/notifications.ts`, integration with SessionManager exit events
- **Traceability:** FR-07.1–FR-07.3, US-22
- **Complexity:** Low
- **Dependencies:** T-006
- **Parallel with:** T-018, T-020
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** Minimize app → kill a session from another terminal → OS notification appears with session name and exit code

### T-020: Implement agent pack warning banner and install button

- **Objective:** On startup, check if the coding-agent-pack is globally installed. If not, show a persistent warning banner with "Install globally" button. Button runs the OS-appropriate installer. Banner disappears after successful install.
- **Deliverables:** `packages/renderer/src/components/AgentPackBanner.tsx`, IPC integration with AgentPackManager
- **Traceability:** FR-03.2–FR-03.4, US-00
- **Complexity:** Low
- **Dependencies:** T-007, T-011
- **Parallel with:** T-018, T-019
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** Remove `~/.agents/skills/requirements-engineer/` → restart app → banner visible → click install → banner disappears → directory exists

---

## M6 — Remote API

M6 can run in parallel with M5 (backend-only server, no desktop UI dependency beyond settings).

### T-021: Implement Fastify HTTP server with auth

- **Objective:** Create `src/main/api/` with Fastify instance. Implement: port probe starting at 9100, POST `/auth` (username/password → JWT HS256, 24h expiry, in-memory signing key), bearer token middleware on all routes, HTTP Basic Auth fallback, `@fastify/rate-limit` on `/auth` (5/min/IP). Bind to `0.0.0.0` by default. Disabled by default (opt-in).
- **Deliverables:** `packages/main/src/api/server.ts`, `packages/main/src/api/auth.ts`, `packages/main/src/api/middleware.ts`
- **Traceability:** FR-08.1–FR-08.5, FR-08.8–FR-08.9, Security Plan §3.1, §4.1
- **Complexity:** High
- **Dependencies:** T-005 (credentials store)
- **Parallel with:** T-022
- **Model:** GPT 5.4 (OpenAI, high effort)
- **Model notes:** Security-critical auth code, needs strong reasoning for JWT, bcrypt, rate limiting
- **Agent type:** general-purpose
- **Validation:** Start server → unauthenticated request → 401; POST /auth with valid creds → JWT; use JWT → 200; 6th auth attempt in 1 min → 429; port collision → auto-selects next port

### T-022: Implement REST + WebSocket API routes

- **Objective:** Add REST routes: `GET /projects`, `GET /projects/:id/sessions`, `POST /projects/:id/sessions`. Add WebSocket routes: `/ws/sessions/:id/output` (streaming terminal output), `/ws/sessions/:id/input` (terminal input). No project create/delete/rename via API (FR-08.7). WebSocket auth via JWT in first message. Connection limits (10/user). Payload max 64KB.
- **Deliverables:** `packages/main/src/api/routes/projects.ts`, `packages/main/src/api/routes/sessions.ts`, `packages/main/src/api/ws/terminal.ts`
- **Traceability:** FR-08.6–FR-08.7, Security Plan §4.7
- **Complexity:** High
- **Dependencies:** T-021, T-006 (SessionManager for terminal data)
- **Parallel with:** None (depends on T-021)
- **Model:** GPT 5.4 (OpenAI, high effort)
- **Agent type:** general-purpose
- **Validation:** List projects via REST; create session via REST → appears in list; WebSocket streams terminal output in real time; input via WebSocket → appears in terminal; unauthenticated WebSocket closed after 5s; 11th connection → rejected

---

## M7 — Remote Web UI

### T-023: Build remote web UI shell

- **Objective:** Create `packages/web/` React SPA: auth screen (login form → stores token in sessionStorage), project list, session tree (hierarchical), terminal view (full-width xterm.js), new session dialog. Mobile-first layout (320px minimum). Same monochrome palette as desktop (Tailwind shared config). Use relative URLs for HTTP/HTTPS compatibility. Auto-reconnect on WebSocket disconnect.
- **Deliverables:**
  - `packages/web/src/App.tsx`
  - `packages/web/src/components/AuthScreen.tsx`
  - `packages/web/src/components/ProjectList.tsx`
  - `packages/web/src/components/SessionTree.tsx`
  - `packages/web/src/components/TerminalView.tsx`
  - `packages/web/src/components/NewSessionDialog.tsx`
  - `packages/web/src/api/api.ts` (typed fetch wrappers)
  - `packages/web/src/api/ws.ts` (WebSocket manager)
- **Traceability:** FR-09.1–FR-09.8, US-26–US-29
- **Complexity:** High (heavy frontend, new SPA)
- **Dependencies:** T-022 (API routes to connect to)
- **Parallel with:** T-024
- **Model:** Gemini 3.1 Pro (Google)
- **Model notes:** Heavy frontend creation (new SPA from scratch) — Gemini 3.1 Pro recommended
- **Agent type:** general-purpose
- **Validation:** Access web UI from phone browser → login → see project tree → tap session → live terminal output → send input → output updates; 320px viewport renders correctly; works behind HTTP and HTTPS proxy

### T-024: Serve remote web UI static bundle from Fastify

- **Objective:** Configure Fastify to serve the Vite-built web UI bundle from `dist/web/` as static files. Ensure the SPA fallback (all non-API routes serve `index.html`).
- **Deliverables:** Static file serving middleware in `packages/main/src/api/server.ts`
- **Traceability:** FR-09.1, Architecture → `remote_web_ui`
- **Complexity:** Low
- **Dependencies:** T-021
- **Parallel with:** T-023
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** `pnpm build` → web bundle in dist/web/ → Fastify serves index.html → SPA loads

---

## M8 — Polish & Packaging

### T-025: Build settings panel

- **Objective:** Create the full settings panel in desktop UI per UIUX §5.5: General (theme), Remote API (enable/disable, port, credentials), Agent CLIs (installation status), coding-agent-pack (version, reinstall), Danger zone (reset). Two-column layout (nav + content).
- **Deliverables:** `packages/renderer/src/components/Settings/` — `SettingsPanel.tsx`, `GeneralSettings.tsx`, `RemoteApiSettings.tsx`, `CliSettings.tsx`, `PackSettings.tsx`
- **Traceability:** UIUX §5.5, FR-08.2, US-23–US-25
- **Complexity:** Medium
- **Dependencies:** T-013 (project settings wiring), T-021 (remote API settings)
- **Parallel with:** T-026, T-027
- **Model:** Sonnet 4.6 (Anthropic)
- **Model notes:** Building on well-established desktop UI — Sonnet good at iterating on existing React
- **Agent type:** general-purpose
- **Validation:** Open settings → toggle remote API → port displayed → change credentials → persisted via safeStorage → verify CLI detection status

### T-026: Implement keyboard shortcuts and quick-launch

- **Objective:** Implement configurable keyboard shortcuts per UIUX §9: `Ctrl/Cmd+N` (new project), `Ctrl/Cmd+T` (new session), `Ctrl/Cmd+Shift+T` (new sub-session), `Ctrl/Cmd+W` (kill session with confirmation), `Ctrl/Cmd+,` (settings). Full arrow-key sidebar navigation.
- **Deliverables:** Keyboard shortcut registration in main + renderer, quick-launch dialog
- **Traceability:** NFR-04.3, UIUX §9, US-12
- **Complexity:** Low
- **Dependencies:** T-011 (UI shell)
- **Parallel with:** T-025, T-027
- **Model:** GPT 5.4 mini (OpenAI, low effort)
- **Agent type:** general-purpose
- **Validation:** Each shortcut triggers the expected action; arrow keys traverse sidebar; shortcuts work on all three platforms

### T-027: Configure electron-builder for all platforms

- **Objective:** Set up electron-builder targets: Linux (AppImage + deb), macOS (dmg, universal binary), Windows (NSIS installer). Include extraResources (coding-agent-pack, mcp-wrapper.js, dist/web/). Set up code signing placeholders for macOS/Windows.
- **Deliverables:** `electron-builder.yml` (complete), build scripts in `package.json`
- **Traceability:** Architecture → `deployment_topology`, AC-11
- **Complexity:** Medium
- **Dependencies:** T-004 (initial electron-builder config)
- **Parallel with:** T-025, T-026
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** `pnpm build:linux` produces AppImage; `pnpm build:mac` produces dmg; `pnpm build:win` produces NSIS exe; all include bundled resources

### T-028: IPC output batching and performance optimization

- **Objective:** Implement PTY output batching in main process (accumulate for up to 16ms, then send as single IPC message). Same batching for WebSocket broadcast. Verify 10 concurrent sessions at 60fps. Implement lazy xterm.js disposal for exited sessions (5min timeout).
- **Deliverables:** Output batching logic in SessionManager, xterm.js lifecycle management in renderer
- **Traceability:** NFR-01.1–NFR-01.3, Architecture → `scalability_and_performance`
- **Complexity:** Medium
- **Dependencies:** T-014 (terminal integration working)
- **Parallel with:** T-025, T-026, T-027
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** general-purpose
- **Validation:** 10 sessions open simultaneously → no frame drops below 30fps; remote WebSocket latency < 500ms on LAN

---

## Testing Milestones

Testing tasks run in parallel with their respective milestones.

### T-029: Unit tests for M1 backend services

- **Objective:** Write Vitest unit tests for: PersistenceStore, SessionManager, AgentPackManager, harness adapter, circular buffer. Mock node-pty for SessionManager tests.
- **Deliverables:** Test files in `packages/main/src/**/__tests__/`
- **Traceability:** All FR-01, FR-02, FR-03, FR-06
- **Complexity:** Medium
- **Dependencies:** T-005, T-006, T-007, T-008
- **Parallel with:** M3, M4 work
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** test-engineer
- **Validation:** All tests pass; coverage > 80% for core modules

### T-030: Unit tests for MCP orchestrator and security controls

- **Objective:** Write Vitest unit tests for McpOrchestrator covering: all 5 tools, yolo inheritance enforcement, project scoping, session limits, depth limits, rate limits, JSON Schema validation. These tests verify the security plan controls.
- **Deliverables:** `packages/main/src/mcp/__tests__/orchestrator.test.ts`
- **Traceability:** FR-05.1–FR-05.7, FR-06.5–FR-06.6, Security Plan §3.2, §3.3, §4.5
- **Complexity:** High
- **Dependencies:** T-015
- **Parallel with:** M5, M6 work
- **Model:** GPT 5.4 (OpenAI, high effort)
- **Model notes:** Security-critical tests need comprehensive coverage of edge cases
- **Agent type:** test-engineer
- **Validation:** All tests pass; 100% branch coverage on security enforcement paths

### T-031: Unit tests for Remote API auth and routes

- **Objective:** Write Vitest unit tests for Fastify auth flow, JWT validation, rate limiting, REST routes, WebSocket auth. Use Fastify's built-in `inject` for HTTP testing.
- **Deliverables:** `packages/main/src/api/__tests__/`
- **Traceability:** FR-08.1–FR-08.9, Security Plan §3.1
- **Complexity:** Medium
- **Dependencies:** T-021, T-022
- **Parallel with:** M7 work
- **Model:** GPT 5.3 codex (OpenAI, medium effort)
- **Agent type:** test-engineer
- **Validation:** All tests pass; unauthenticated access correctly rejected; rate limiting triggers; JWT expiry enforced

### T-032: E2E tests with Playwright

- **Objective:** Write Playwright E2E tests using `@playwright/test` Electron integration: app launch, create project, create session, terminal I/O, kill session, session hierarchy display, settings panel, agent pack banner.
- **Deliverables:** `e2e/` test directory with Playwright config and test files
- **Traceability:** AC-01 through AC-11
- **Complexity:** High
- **Dependencies:** M5 complete (full desktop app functional)
- **Parallel with:** T-027
- **Model:** GPT 5.4 (OpenAI, high effort)
- **Agent type:** test-engineer
- **Validation:** All E2E tests pass on Linux; critical acceptance criteria (AC-01 through AC-10) covered

---

## Parallelism Summary

```
Timeline (sprints are illustrative, not prescriptive):

Sprint 1:  T-001 ─┬─ T-002 ─┐
           T-003 ─┘          │
                              ▼
Sprint 2:  T-005 ─┬─ T-010 ──┤  (M1 + M2 in parallel)
           T-006 ─┤  T-011 ──┤
           T-007 ─┤  T-012 ──┘
           T-008 ─┤
           T-009 ─┘
           T-004 ─┘

Sprint 3:  T-013 ─┬─ T-015 ──┤  (M3 + M4 in parallel)
           T-014 ─┘  T-016 ──┘
                     T-029 ──┘  (testing M1)

Sprint 4:  T-017 ────────────┤  (M4 completion)
           T-018 ─┬─ T-021 ──┤  (M5 + M6 in parallel)
           T-019 ─┤  T-022 ──┘
           T-020 ─┘
           T-030 ─────────────┘  (testing MCP)

Sprint 5:  T-023 ─┬─ T-025 ──┤  (M7 + M8 in parallel)
           T-024 ─┘  T-026 ──┤
                     T-027 ──┤
                     T-028 ──┘
                     T-031 ──┘  (testing API)

Sprint 6:  T-032 ─────────────┘  (E2E tests)
```

### Maximum parallel workers per sprint:

| Sprint | Parallel tasks | Max concurrent workers |
|--------|---------------|----------------------|
| 1      | T-001, T-003 → T-002, T-004 | 2–3 |
| 2      | T-005–T-009, T-010–T-012 | **8** (peak parallelism) |
| 3      | T-013–T-014, T-015–T-016, T-029 | **5** |
| 4      | T-017, T-018–T-020, T-021–T-022, T-030 | **6** |
| 5      | T-023–T-024, T-025–T-028, T-031 | **7** |
| 6      | T-032 | 1 |

---

## Task Summary Table

| ID | Name | Milestone | Complexity | Model | Provider | Effort | Agent | Depends On |
|----|------|-----------|-----------|-------|----------|--------|-------|-----------|
| T-001 | Init monorepo | M0 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | — |
| T-002 | Configure electron-vite | M0 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-001 |
| T-003 | Shared TypeScript types | M0 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | — |
| T-004 | Bundle agent pack | M0 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-002 |
| T-005 | PersistenceStore | M1 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-003 |
| T-006 | SessionManager | M1 | High | GPT 5.4 | OpenAI | high | general-purpose | T-003 |
| T-007 | AgentPackManager | M1 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-003 |
| T-008 | Harness adapter | M1 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-003 |
| T-009 | electron-log setup | M1 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-001 |
| T-010 | Electron main + security | M2 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-002 |
| T-011 | Desktop UI shell | M2 | High | Gemini 3.1 Pro | Google | — | general-purpose | T-002, T-003 |
| T-012 | Preload / IPC bridge | M2 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-003 |
| T-013 | Wire project CRUD | M3 | Medium | Sonnet 4.6 | Anthropic | — | general-purpose | T-005, T-011, T-012 |
| T-014 | Wire sessions + xterm.js | M3 | High | Sonnet 4.6 | Anthropic | — | general-purpose | T-006, T-011, T-012 |
| T-015 | McpOrchestrator | M4 | High | GPT 5.4 | OpenAI | high | general-purpose | T-006 |
| T-016 | McpStdioWrapper | M4 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-003 |
| T-017 | MCP wrapper integration | M4 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-015, T-016, T-006, T-008 |
| T-018 | Yolo UI indicators | M5 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-013, T-014 |
| T-019 | OS notifications | M5 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-006 |
| T-020 | Agent pack banner | M5 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-007, T-011 |
| T-021 | Fastify server + auth | M6 | High | GPT 5.4 | OpenAI | high | general-purpose | T-005 |
| T-022 | REST + WebSocket routes | M6 | High | GPT 5.4 | OpenAI | high | general-purpose | T-021, T-006 |
| T-023 | Remote web UI shell | M7 | High | Gemini 3.1 Pro | Google | — | general-purpose | T-022 |
| T-024 | Serve static bundle | M7 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-021 |
| T-025 | Settings panel | M8 | Medium | Sonnet 4.6 | Anthropic | — | general-purpose | T-013, T-021 |
| T-026 | Keyboard shortcuts | M8 | Low | GPT 5.4 mini | OpenAI | low | general-purpose | T-011 |
| T-027 | electron-builder config | M8 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-004 |
| T-028 | Performance optimization | M8 | Medium | GPT 5.3 codex | OpenAI | medium | general-purpose | T-014 |
| T-029 | Unit tests — backend | Test | Medium | GPT 5.3 codex | OpenAI | medium | test-engineer | T-005–T-008 |
| T-030 | Unit tests — MCP/security | Test | High | GPT 5.4 | OpenAI | high | test-engineer | T-015 |
| T-031 | Unit tests — API | Test | Medium | GPT 5.3 codex | OpenAI | medium | test-engineer | T-021, T-022 |
| T-032 | E2E tests — Playwright | Test | High | GPT 5.4 | OpenAI | high | test-engineer | M5 complete |

---

## Open Items

1. **Yolo flags for OpenCode and Gemini CLI:** Architecture still treats these as CLI-docs-dependent and should keep them harness-configurable.
2. **Per-CLI MCP injection drift:** Codex and OpenCode are treated as supported, but their inline configuration formats may change. T-017 should keep those templates adapter-driven and covered by regression tests.
3. **UIUX open questions #2–#4:** Sidebar collapse state persistence, status dot scalability, and remote web UI component sharing remain unresolved. These are non-blocking for M0–M4 but should be decided before M7–M8.

---

## Artifact Location

This plan is saved at: `.agent_specs/kleiber_1_execution_plan.md`
