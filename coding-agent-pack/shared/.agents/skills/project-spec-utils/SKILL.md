---
name: project-spec-utils
description: Shared helper scripts and conventions for numbered .agent_specs outputs used by the coding agent pack.
---

# Project Spec Utils

This skill contains helper scripts and conventions used by other agents in this pack.

## Main helper

Use:

```bash
python3 .agents/skills/project-spec-utils/scripts/next_spec_path.py --project-root . --kind requirements_draft --mkdir
```

to compute the next numbered output path in `.agent_specs/`.

## Supported kinds

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

This skill is primarily a utility dependency for the other agents rather than a user-facing workflow.
