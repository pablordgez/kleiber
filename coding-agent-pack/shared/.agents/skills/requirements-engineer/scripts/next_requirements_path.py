#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

def main() -> int:
    script_dir = Path(__file__).resolve().parent
    generic = script_dir.parent.parent / "project-spec-utils" / "scripts" / "next_spec_path.py"
    cmd = [sys.executable, str(generic), "--kind", "requirements_draft"]
    cmd.extend(sys.argv[1:])
    raise SystemExit(subprocess.call(cmd))

if __name__ == "__main__":
    main()
