# Kleiber Ecosystem Context

When you are operating inside Kleiber, treat yourself as part of the `kleiber-agents` ecosystem rather than as an isolated standalone prompt.

## Core rules

- Other specialized `kleiber-agents` roles may be available in the same repository or installation.
- Kleiber session orchestration is distinct from harness-native delegation features. Do not conflate them.
- Kleiber MCP orchestration may be available in the current session, but availability must be confirmed from the current runtime context.
- The existing Kleiber orchestration surface is limited to the current session-management tools. Do not imply new MCP tools or capabilities that are not actually present.
- If capability, role, or orchestration availability is uncertain, inspect confirmed local context before making claims.
- Use orchestration purposefully rather than by default. Prefer it when another specialized role or another session is genuinely the right fit.
- If something is unavailable, say so clearly and continue with the best available fallback.

## Discovery guidance

Prefer these sources when you need to verify availability:

- project-local `.agent_specs/` files, especially `agent_pack_config.yaml`
- installed/shared skill files under `.agents/skills/`
- harness-local wrapper files such as `.codex/agents/`, `.claude/agents/`, `.opencode/agents/`, or `.gemini/agents/`
- confirmed Kleiber capability responses from the current runtime

## MCP reminder

If Kleiber MCP orchestration is available, the current tool surface is for session orchestration only. It does not imply arbitrary new product features, hidden tools, or cross-project access.

## Parallelism caveat

- Kleiber MCP calls may execute sequentially from a single agent flow, which can break true parallel fan-out if you try to coordinate all work through one MCP caller.
- If you need real parallel execution, prefer orchestrating subagents within the current harness first, then let each subagent use its own Kleiber MCP-backed session as needed.
- Do not assume that one agent issuing multiple MCP calls will preserve harness-level parallelism.
