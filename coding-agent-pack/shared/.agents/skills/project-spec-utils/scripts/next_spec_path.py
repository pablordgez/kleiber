#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

KIND_SUFFIX = {
    "requirements_draft": "requirements_draft.md",
    "brainstorm": "brainstorm.md",
    "requirements_final": "requirements_final.md",
    "architecture": "architecture.yaml",
    "security_plan": "security_plan.md",
    "UIUX": "UIUX.md",
    "execution_plan": "execution_plan.md",
    "spec_remediation": "spec_remediation.md",
    "security_remediation": "security_remediation.md",
    "test_remediation": "test_remediation.md",
}

ANY_SPEC_RE = re.compile(r"^(?P<project>.+?)_(?P<num>\d+)_(?P<kind>[^/]+)\.(?:md|yaml|yml)$")


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    return value or "project"


def infer_project_name(project_root: Path, agent_specs: Path) -> str:
    candidates: list[tuple[int, str]] = []
    if agent_specs.exists():
        for p in agent_specs.iterdir():
            m = ANY_SPEC_RE.match(p.name)
            if m:
                candidates.append((int(m.group("num")), m.group("project")))
    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]

    repo_name = project_root.name.strip()
    if repo_name:
        return slugify(repo_name)
    return "project"


def next_num(agent_specs: Path, suffix: str, project_name: str | None = None) -> int:
    pattern = re.compile(rf"^(?P<project>.+?)_(?P<num>\d+)_{re.escape(suffix)}$")
    highest = 0
    if agent_specs.exists():
        for p in agent_specs.iterdir():
            m = pattern.match(p.name)
            if not m:
                continue
            if project_name and m.group("project") != project_name:
                continue
            highest = max(highest, int(m.group("num")))
    return highest + 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute the next numbered .agent_specs output path.")
    parser.add_argument("--project-root", default=".", help="Project root directory")
    parser.add_argument("--kind", required=True, choices=sorted(KIND_SUFFIX))
    parser.add_argument("--project-name", help="Optional explicit project name")
    parser.add_argument("--mkdir", action="store_true", help="Create .agent_specs if missing")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    agent_specs = project_root / ".agent_specs"
    if args.mkdir:
        agent_specs.mkdir(parents=True, exist_ok=True)

    project_name = slugify(args.project_name) if args.project_name else infer_project_name(project_root, agent_specs)
    suffix = KIND_SUFFIX[args.kind]
    number = next_num(agent_specs, suffix, project_name)
    filename = f"{project_name}_{number}_{suffix}"
    abs_path = agent_specs / filename

    result = {
        "project_root": str(project_root),
        "project_name": project_name,
        "kind": args.kind,
        "draft_number": number,
        "absolute_path": str(abs_path),
        "relative_path": str(Path(".agent_specs") / filename),
        "agent_specs_exists": agent_specs.exists(),
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
