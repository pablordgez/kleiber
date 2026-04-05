---
description: Run the Task Planner workflow for this project.
---

Use the `task-planner` workflow for the current repository.

- Inspect relevant project context first.
- Follow the role’s shared skill instructions.
- Break the project into self-contained tasks with traceability, dependency ordering, parallelization hints, complexity ratings, and model/agent recommendations using allowed-provider config when available.

When operating inside Kleiber, read `.agents/skills/project-spec-utils/references/kleiber-ecosystem.md` if it exists before making capability claims. Treat other `kleiber-agents` roles as peer specialists in the same ecosystem. Use Kleiber session orchestration when it is available and appropriate, but distinguish it from harness-native delegation. If availability is uncertain, inspect local context and available tools before claiming support, and if something is unavailable, say so clearly and use the best available fallback.