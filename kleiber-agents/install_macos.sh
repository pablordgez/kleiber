#!/bin/bash
set -euo pipefail

MODE="project"
ROOT="$(pwd)"
LINK_MODE="link"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$SCRIPT_DIR"

AGENTS=(
  requirements-engineer
  brainstormer
  requirements-refiner
  architect
  security-analyst
  ui-ux-designer
  task-planner
  project-manager
  documentation-writer
  specification-reviewer
  security-reviewer
  test-engineer
  field-tester
  project-spec-utils
)

usage() {
  cat <<'USAGE'
Usage: ./install.sh [--mode project|global] [--root PATH] [--copy]

Options:
  --mode   Install into a project directory (default) or user-global locations.
  --root   Project root for --mode project. Defaults to current directory.
  --copy   Copy files instead of creating symlinks where possible.
USAGE
}

command_name_for() {
  case "$1" in
    requirements-engineer) echo "requirements" ;;
    brainstormer) echo "brainstorm" ;;
    requirements-refiner) echo "refine-requirements" ;;
    architect) echo "architect" ;;
    security-analyst) echo "security-plan" ;;
    ui-ux-designer) echo "uiux" ;;
    task-planner) echo "task-plan" ;;
    project-manager) echo "execute-plan" ;;
    documentation-writer) echo "write-docs" ;;
    specification-reviewer) echo "review-spec" ;;
    security-reviewer) echo "review-security" ;;
    test-engineer) echo "test-engineer" ;;
    field-tester) echo "field-test" ;;
    *)
      echo "Unknown agent command mapping: $1" >&2
      return 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --mode" >&2
        usage >&2
        exit 1
      fi
      MODE="$2"
      shift 2
      ;;
    --root)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --root" >&2
        usage >&2
        exit 1
      fi
      ROOT="$2"
      shift 2
      ;;
    --copy)
      LINK_MODE="copy"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

mkdir_p() {
  mkdir -p "$1"
}

install_path() {
  local src="$1"
  local dst="$2"

  if [[ ! -e "$src" ]]; then
    echo "Source path not found: $src" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"

  if [[ "$LINK_MODE" == "copy" ]]; then
    cp -R "$src" "$dst"
  else
    ln -s "$src" "$dst"
  fi
}

copy_file() {
  local src="$1"
  local dst="$2"

  if [[ ! -e "$src" ]]; then
    echo "Source file not found: $src" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

write_gitkeep() {
  local dir="$1"
  mkdir -p "$dir"
  : > "$dir/.gitkeep"
}

install_skill_family() {
  local skill_root_src="$1"
  local skill_root_dst="$2"
  local agent

  mkdir -p "$skill_root_dst"

  for agent in "${AGENTS[@]}"; do
    install_path "$skill_root_src/$agent" "$skill_root_dst/$agent"
  done
}

install_wrappers() {
  local codex_agents_dir="$1"
  local claude_agents_dir="$2"
  local opencode_agents_dir="$3"
  local opencode_commands_dir="$4"
  local gemini_agents_dir="$5"
  local gemini_commands_dir="$6"
  local agent command_name

  mkdir -p \
    "$codex_agents_dir" \
    "$claude_agents_dir" \
    "$opencode_agents_dir" \
    "$opencode_commands_dir" \
    "$gemini_agents_dir" \
    "$gemini_commands_dir"

  for agent in "${AGENTS[@]}"; do
    if [[ "$agent" == "project-spec-utils" ]]; then
      continue
    fi

    command_name="$(command_name_for "$agent")"

    copy_file "$BUNDLE_ROOT/templates/codex/agents/$agent.toml" \
              "$codex_agents_dir/$agent.toml"

    copy_file "$BUNDLE_ROOT/templates/claude/agents/$agent.md" \
              "$claude_agents_dir/$agent.md"

    copy_file "$BUNDLE_ROOT/templates/opencode/agents/$agent.md" \
              "$opencode_agents_dir/$agent.md"

    copy_file "$BUNDLE_ROOT/templates/opencode/commands/$command_name.md" \
              "$opencode_commands_dir/$command_name.md"

    copy_file "$BUNDLE_ROOT/templates/gemini/agents/$agent.md" \
              "$gemini_agents_dir/$agent.md"

    copy_file "$BUNDLE_ROOT/templates/gemini/commands/$command_name.toml" \
              "$gemini_commands_dir/$command_name.toml"
  done
}

install_project() {
  local project_root
  project_root="$(cd "$ROOT" && pwd)"

  install_skill_family "$BUNDLE_ROOT/shared/.agents/skills" "$project_root/.agents/skills"
  install_skill_family "$project_root/.agents/skills" "$project_root/.claude/skills"
  install_skill_family "$project_root/.agents/skills" "$project_root/.gemini/skills"

  install_wrappers \
    "$project_root/.codex/agents" \
    "$project_root/.claude/agents" \
    "$project_root/.opencode/agents" \
    "$project_root/.opencode/commands" \
    "$project_root/.gemini/agents" \
    "$project_root/.gemini/commands"

  write_gitkeep "$project_root/.agent_specs"

  if [[ ! -e "$project_root/.agent_specs/agent_pack_config.example.yaml" ]]; then
    copy_file "$BUNDLE_ROOT/shared/.agents/agent_pack_config.example.yaml" \
              "$project_root/.agent_specs/agent_pack_config.example.yaml"
  fi

  echo "Installed project-local kleiber-agents into: $project_root"
}

install_global() {
  local home_dir="$HOME"

  install_skill_family "$BUNDLE_ROOT/shared/.agents/skills" "$home_dir/.agents/skills"
  install_skill_family "$home_dir/.agents/skills" "$home_dir/.claude/skills"
  install_skill_family "$home_dir/.agents/skills" "$home_dir/.gemini/skills"

  install_wrappers \
    "$home_dir/.codex/agents" \
    "$home_dir/.claude/agents" \
    "$home_dir/.config/opencode/agents" \
    "$home_dir/.config/opencode/commands" \
    "$home_dir/.gemini/agents" \
    "$home_dir/.gemini/commands"

  echo "Installed global kleiber-agents into home-directory harness locations."
}

case "$MODE" in
  project)
    install_project
    ;;
  global)
    install_global
    ;;
  *)
    echo "Invalid --mode: $MODE" >&2
    usage >&2
    exit 1
    ;;
esac
