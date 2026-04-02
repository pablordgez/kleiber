# kleiber-agents

A bundle of different coding agents for a full agentic programming workflow.

The legacy name `coding-agent-pack` remains supported as a compatibility alias for one release cycle inside Kleiber. New docs and runtime behavior should treat `kleiber-agents` as the primary name.

## Included agents

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

## Bundle design

The pack follows a portable structure:

1. **Canonical behavior lives in shared skills**
   - `shared/.agents/skills/<agent>/SKILL.md`
2. **Harness-specific wrappers stay thin**
   - Codex: `.codex/agents/*.toml`
   - Claude Code: `.claude/agents/*.md`
   - OpenCode: `.opencode/agents/*.md`
   - Gemini CLI: `.gemini/agents/*.md`
3. **Convenience commands are included where they fit naturally**
   - OpenCode: `.opencode/commands/*.md`
   - Gemini CLI: `.gemini/commands/*.toml`

This keeps the workflows portable while still feeling native in each harness.

## Project install

From your project root:

```bash
/path/to/kleiber-agents/install.sh --mode project
```

Or explicitly:

```bash
/path/to/kleiber-agents/install.sh --mode project --root /path/to/project
```

By default the installer uses symlinks where practical so the shared skill remains canonical. To copy instead:

```bash
/path/to/kleiber-agents/install.sh --mode project --copy
```

## Global install

```bash
/path/to/kleiber-agents/install.sh --mode global
```

## What gets installed

### Shared skills
- `.agents/skills/<agent>/...`
- `.claude/skills/<agent>/...`
- `.gemini/skills/<agent>/...`

### Harness wrappers
- `.codex/agents/*.toml`
- `.claude/agents/*.md`
- `.opencode/agents/*.md`
- `.opencode/commands/*.md`
- `.gemini/agents/*.md`
- `.gemini/commands/*.toml`

### Spec workspace
- `.agent_specs/.gitkeep`
- `.agent_specs/agent_pack_config.example.yaml`

## Recommended configuration

Copy and customize:

```bash
cp .agent_specs/agent_pack_config.example.yaml .agent_specs/agent_pack_config.yaml
```

This lets the task-planner and project-manager reason about:
- which providers are allowed
- which models are preferred for low / medium / high complexity
- which harnesses are usable
- whether any MCP or other adapters exist for cross-harness orchestration

## Output contracts

These agents create numbered artifacts in `.agent_specs/`:

- `requirements-engineer` → `{project_name}_{x}_requirements_draft.md`
- `brainstormer` → `{project_name}_{x}_brainstorm.md`
  - if the user explicitly asks to incorporate the ideas, it should create a new numbered requirements draft instead of overwriting
- `requirements-refiner` → `{project_name}_{x}_requirements_final.md`
- `architect` → `{project_name}_{x}_architecture.yaml`
- `security-analyst` → `{project_name}_{x}_security_plan.md`
- `ui-ux-designer` → `{project_name}_{x}_UIUX.md`
- `task-planner` → `{project_name}_{x}_execution_plan.md`
- `specification-reviewer` remediation output → `{project_name}_{x}_spec_remediation.md`
- `security-reviewer` remediation output → `{project_name}_{x}_security_remediation.md`
- `field-tester` remediation output → `{project_name}_{x}_test_remediation.md`
- `field-tester` screenshots → `{project_name}_{x}_test_screenshots/`

Other agents usually update the codebase or docs directly instead of writing a numbered artifact unless the user asks for one.

## Shared helper script

Use this to compute the next numbered output path:

```bash
python3 .agents/skills/project-spec-utils/scripts/next_spec_path.py --project-root . --kind execution_plan --mkdir
```

Supported `--kind` values:
- `requirements_draft`
- `brainstorm`
- `requirements_final`
- `architecture`
- `security_plan`
- `UIUX`
- `execution_plan`
- `spec_remediation`
- `security_remediation`
- `test_remediation`

The original compatibility helper is still present at:

```text
.agents/skills/requirements-engineer/scripts/next_requirements_path.py
```

## Notes on orchestration-heavy agents

### Project manager
The `project-manager` agent is written to be honest about harness limitations:
- It should only claim orchestration when the current harness genuinely supports it.
- It should fall back to sequential execution when orchestration is unsupported or unavailable.
- It should surface missing adapters / MCP when a requested model or external harness cannot be launched from the current environment.
- It should isolate parallel workers with separate git branches and worktrees when possible.

### Field tester
The `field-tester` agent only runs realistic manual-style testing when the harness actually has browser/device/computer-use/MCP capabilities available. Otherwise it should say exactly what is missing.

## Suggested usage pattern

A common flow is:

1. `requirements-engineer`
2. `brainstormer`
3. `requirements-refiner`
4. `architect`
5. `security-analyst`
6. `ui-ux-designer`
7. `task-planner`
8. `project-manager`
9. `documentation-writer`
10. `specification-reviewer` / `security-reviewer` / `test-engineer` / `field-tester`

## Extending the pack

To add more agents later:
1. add a new canonical skill under `shared/.agents/skills/<name>/`
2. add thin wrappers in `templates/`
3. update `install.sh`

That keeps the pack portable.
