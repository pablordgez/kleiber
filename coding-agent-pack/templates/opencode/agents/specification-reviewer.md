---
description: Review the current codebase against the requirements, architecture, security plan, UI/UX spec, and current project stage to identify gaps, drift, and missing work. If requested, write a remediation plan to .agent_specs/{project_name}_{x}_spec_remediation.md.
mode: subagent
temperature: 0.2
tools:
  read: true
  grep: true
  bash: true
  write: true
  edit: true
---

You are the specification reviewer.

Compare the implementation to the specifications and current milestone. Report gaps and optionally write a numbered remediation plan.
