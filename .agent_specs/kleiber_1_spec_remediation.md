# Kleiber - Specification Remediation Plan

| Field | Value |
|---|---|
| **Project** | Kleiber |
| **Kind** | Specification Remediation |
| **Version** | 1 |
| **Date** | 2026-04-01 |
| **Branch** | `m3-remediation` |
| **Scope** | Review and remediation of implementation through M3 |
| **Sources** | `kleiber_1_requirements_final.md`, `kleiber_1_execution_plan.md`, `kleiber_1_architecture.yaml`, `kleiber_1_security_plan.md`, `kleiber_1_UIUX.md` |

## 1. Goal

Bring the current codebase into conformance with the specified scope through M3 by fixing the concrete implementation gaps found in the review, validating the corrected behavior, then merging the remediation back into `M3` and reopening the milestone PR with explicit remediation scope.

## 2. Confirmed Gaps

### 2.1 Implemented but off-spec

1. Session creation uses `process.cwd()` instead of the selected project's directory, violating FR-02.1.
2. Agent and agent+role launch ignores the harness adapter layer and bundled role configuration, violating FR-03.6, FR-03.7, US-06, and T-014 intent.
3. Sub-session creation is not wired through renderer -> preload -> IPC -> `SessionManager`, so hierarchy creation is incomplete for US-07 and FR-02.4.
4. Session naming exists in the backend but is not represented in the shared contract or rendered in the UI, so US-10 is effectively not delivered.
5. Killed sessions are removed from the sidebar immediately instead of remaining visible in exited state, violating FR-02.6.
6. The xterm integration omits required configuration and layout capabilities, leaving FR-04.2 and FR-04.4 only partially met.

### 2.2 Not started

1. Project creation does not create the target directory on disk, so FR-01.2 is not implemented.
2. Pack-related IPC handlers are still stubs, preventing the renderer from using real role and harness metadata for M3 session creation flow.

### 2.3 Missing regression coverage

1. There are no renderer, preload, or IPC integration tests covering the desktop flows that failed the review.
2. Existing test coverage is concentrated in isolated backend units and does not guard the M3 wiring layer.

## 3. Remediation Strategy

### 3.1 Sequence

1. Fix shared contract and main-process IPC semantics first.
2. Wire the renderer to the corrected contract and real pack/session behavior next.
3. Tighten terminal behavior and session presentation.
4. Add regression tests for the repaired M3 flows.
5. Validate, merge `m3-remediation` into `M3`, and reopen the PR with updated title/body reflecting both milestone delivery and remediation.

### 3.2 OpenAI-only execution policy

All delegated implementation tasks for this remediation must use OpenAI models only.

Recommended model allocation:

1. Backend/shared/IPC: `gpt-5.4` or `gpt-5.3-codex`
2. Renderer integration: `gpt-5.3-codex`
3. Test work: `gpt-5.4` or `gpt-5.3-codex`
4. Lightweight mechanical follow-ups: `gpt-5.4-mini`

## 4. Task Plan

### R-001: Correct project and session lifecycle wiring

- **Status:** pending
- **Type:** remediation
- **Priority:** P0
- **Dependencies:** none
- **Primary files:** `packages/main/src/ipc/handlers.ts`, `packages/main/src/store/persistence.ts`
- **Required outcomes:**
  - Creating a project creates the directory on disk when missing
  - Session creation resolves working directory from the selected project by default
  - Session creation forwards `parentSessionId`
  - Kill flows preserve exited sessions in UI-facing data instead of deleting them immediately
- **Traceability:** FR-01.2, FR-02.1, FR-02.4, FR-02.6, US-01, US-07

### R-002: Restore pack-driven agent session creation

- **Status:** pending
- **Type:** remediation
- **Priority:** P0
- **Dependencies:** R-001
- **Primary files:** `packages/main/src/ipc/handlers.ts`, `packages/main/src/pack/agent-pack-manager.ts`, `packages/main/src/pack/harness-adapter.ts`, `packages/preload/src/index.ts`, `packages/shared/src/types.ts`
- **Required outcomes:**
  - Renderer can fetch real bundled roles and pack status through IPC
  - Agent CLI identifiers are normalized to shared types
  - Agent and agent+role sessions launch through resolved harness adapter metadata rather than raw CLI strings
  - Project-local `.agent_specs/agent_pack_config.yaml` is honored for enabled harnesses
- **Traceability:** FR-03.5, FR-03.6, FR-03.7, US-05, US-06, T-014

### R-003: Fix session identity and hierarchy presentation in renderer

- **Status:** pending
- **Type:** remediation
- **Priority:** P0
- **Dependencies:** R-001, R-002
- **Primary files:** `packages/shared/src/types.ts`, `packages/renderer/src/App.tsx`, `packages/renderer/src/store/useAppStore.ts`, `packages/renderer/src/components/Sidebar/ProjectSidebar.tsx`, `packages/renderer/src/components/Dialogs/NewSessionDialog.tsx`, `packages/renderer/src/components/Terminal/SessionHeader.tsx`, `packages/renderer/src/components/ProjectOverview.tsx`
- **Required outcomes:**
  - Session `name` is part of the shared contract and rendered consistently
  - New sub-session actions target the selected parent session
  - Renderer no longer hardcodes invalid CLI identifiers
  - Session rows and breadcrumbs show names rather than truncated ids
- **Traceability:** US-07, US-08, US-10, FR-02.4, T-011, T-014, UIUX §4

### R-004: Complete terminal behavior expected for M3

- **Status:** pending
- **Type:** remediation
- **Priority:** P1
- **Dependencies:** R-003
- **Primary files:** `packages/renderer/src/components/Terminal/TerminalPane.tsx`, `packages/renderer/src/App.tsx`, any new renderer state/components needed for terminal layout
- **Required outcomes:**
  - xterm uses explicit scrollback sizing that satisfies FR-04.2
  - Terminal creation flow handles session switching without stale listeners or state drift
  - Add a concrete multi-terminal arrangement mode consistent with FR-04.4, preferring tabs if that is the smallest compliant remediation
- **Traceability:** FR-04.2, FR-04.4, US-11, US-12, T-014

### R-005: Add regression tests for repaired M3 flows

- **Status:** pending
- **Type:** remediation
- **Priority:** P0
- **Dependencies:** R-001, R-002, R-003
- **Primary files:** new and updated tests in `packages/main/src/ipc/`, `packages/renderer/`, and related test scaffolding
- **Required outcomes:**
  - Test project creation directory behavior
  - Test session creation defaults to project directory
  - Test parent session propagation through IPC/session creation
  - Test pack-driven CLI/role resolution logic
  - Test session naming contract regressions where practical
- **Traceability:** T-013, T-014, FR-01.2, FR-02.1, FR-02.4, FR-03.6

### R-006: Release workflow completion

- **Status:** pending
- **Type:** workflow
- **Priority:** P0
- **Dependencies:** R-001 through R-005
- **Required outcomes:**
  - Merge `m3-remediation` into `M3`
  - Push updated `M3`
  - Reopen or recreate the milestone PR against `main`
  - PR title/body explicitly state the branch now covers both M3 delivery and remediation
- **Traceability:** user workflow instruction for this review/remediation cycle

## 5. Validation Checklist

1. `pnpm test`
2. `pnpm typecheck`
3. `pnpm build`
4. Targeted manual verification of project creation, session creation, sub-session creation, rename visibility, and agent session launch

## 6. Deliverable

This artifact defines the remediation scope and execution sequence for M3. Implementation remains open until the above tasks are complete and the updated M3 PR is back in review.
