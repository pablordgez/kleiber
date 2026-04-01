import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AgentPackManager } from "./agent-pack-manager";

const CONFIG_CONTENT = `version: 1
providers:
  allowed:
    - openai
  disallowed: []
models:
  defaults:
    low_complexity:
      provider: openai
      model: gpt-5.4-mini
    medium_complexity:
      provider: openai
      model: gpt-5.4
    high_complexity:
      provider: openai
      model: gpt-5.4
  notes: []
harness_adapters:
  codex:
    enabled: true
    orchestration: native_subagents
    launch_command: codex
mcp:
  available: []
  notes: []
agent_overrides: {}
`;

test("AgentPackManager detects global install and discovers roles", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pack-manager-test-"));
  const homeDir = path.join(tempRoot, "home");

  try {
    const globalSkillPath = path.join(homeDir, ".agents", "skills", "requirements-engineer", "SKILL.md");
    await mkdir(path.dirname(globalSkillPath), { recursive: true });
    await writeFile(globalSkillPath, "# role", "utf8");

    await mkdir(path.join(homeDir, ".agents", "skills", "architect"), { recursive: true });
    await writeFile(path.join(homeDir, ".agents", "skills", "architect", "SKILL.md"), "# role", "utf8");
    await mkdir(path.join(homeDir, ".agents", "skills", "not-a-role"), { recursive: true });

    const manager = new AgentPackManager({ homeDir, cwd: tempRoot, packRoot: tempRoot });
    assert.equal(await manager.isGlobalInstallPresent(), true);

    const roles = await manager.discoverRoles("global");
    assert.deepEqual(roles, ["architect", "requirements-engineer"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AgentPackManager reads config and reports parser errors in status", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pack-manager-test-"));

  try {
    const configDir = path.join(tempRoot, ".agent_specs");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "agent_pack_config.yaml"), CONFIG_CONTENT, "utf8");

    const manager = new AgentPackManager({
      homeDir: path.join(tempRoot, "home"),
      cwd: tempRoot,
      packRoot: tempRoot,
    });

    const parsed = await manager.readProjectConfig(tempRoot);
    assert.equal(parsed.models.defaults.medium_complexity.model, "gpt-5.4");

    await writeFile(path.join(configDir, "agent_pack_config.yaml"), "version: nope", "utf8");
    const status = await manager.getStatus(tempRoot);
    assert.equal(status.projectConfigExists, true);
    assert.equal(status.projectConfig, null);
    assert.match(status.projectConfigError ?? "", /version/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AgentPackManager executes installer script for global mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pack-manager-test-"));

  try {
    const installScriptPath = path.join(tempRoot, "install.sh");
    await writeFile(
      installScriptPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "echo \"installer args: $*\"",
      ].join("\n"),
      "utf8",
    );

    const manager = new AgentPackManager({
      homeDir: path.join(tempRoot, "home"),
      cwd: tempRoot,
      packRoot: tempRoot,
    });

    const result = await manager.installGlobal({ copy: true });
    assert.equal(result.exitCode, 0);
    assert.equal(result.command, "bash");
    assert.match(result.stdout, /--mode global --copy/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
