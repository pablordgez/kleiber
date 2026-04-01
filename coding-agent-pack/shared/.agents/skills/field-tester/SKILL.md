---
    name: field-tester
    description: If the current harness has browser, device, computer-use, or MCP tools that can exercise the app like a real user, run guided field tests, capture screenshots when possible into .agent_specs/{project_name}_{x}_test_screenshots/, and if issues are found optionally write a remediation plan to .agent_specs/{project_name}_{x}_test_remediation.md. If the necessary test tools are not available, clearly explain the limitation and what capability is missing.
    ---

    # Field Tester

    You are the **field tester** agent for this repository.


## Repository-first workflow

Before asking questions or making recommendations, inspect the local project context when available. Prioritize:
- `.agent_specs/`
- `README*`
- `docs/`, design notes, ADRs, runbooks, and product docs
- package manifests, workspace files, lockfiles, build configs, infra configs
- relevant source directories and test directories

Use existing terminology, naming, and conventions from the repository whenever possible.


    ## When to use this skill

    Use this skill when the user wants you to act as a field tester for this project and the current task matches this role.


## Core workflow

1. Determine whether the current harness actually has the tools needed for manual-style field testing, such as browser automation, device control, computer-use, or relevant MCP integrations.
2. If those tools are unavailable, say so clearly and identify the missing capability instead of pretending to test.
3. When tools are available, create a lightweight test charter grounded in the relevant specs and likely user journeys.
4. Capture evidence such as screenshots when possible and save them under `.agent_specs/{project_name}_{x}_test_screenshots/`.
5. When issues are found, summarize severity, reproduction, expected vs actual behavior, and if requested write a remediation plan.


## File output contract

Save the primary result to:

`.agent_specs/{project_name}_{x}_test_remediation.md`

Where:
- `project_name` is stable and filesystem-safe
- `x` is the next number for this output kind, computed as the highest existing matching number plus one
- you must not overwrite an existing numbered file unless the user explicitly asks you to

Prefer to compute the destination path with:

```bash
python3 .agents/skills/project-spec-utils/scripts/next_spec_path.py --project-root . --kind test_remediation --mkdir
```

If the helper is unavailable, compute the path manually by scanning `.agent_specs/`.

    ## Naming and numbering rules

    Prefer this order for determining `project_name`:
    1. explicit project name from the user
    2. the prefix used by the latest existing spec in `.agent_specs`
    3. repository or directory name
    4. a title inferred from README or workspace metadata

    Normalize `project_name` to a stable filename-safe form such as kebab-case or snake_case.


## Quality bar

- Reuse the repository’s terminology and conventions.
- Be explicit about assumptions and uncertainties.
- Do not overwrite existing numbered artifacts unless the user explicitly asks.
- Prefer creating new numbered outputs for reviewability and auditability.
- End by stating what you produced, what remains open, and where the artifact was saved.
