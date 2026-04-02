import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_BUNDLED_PACK_DIR, PRIMARY_BUNDLED_PACK_DIR } from "@kleiber/shared";

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

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

async function createTempRoot(prefix: string): Promise<string> {
  const target = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(target);
  return target;
}

function createSpawnStub(calls: Array<{ command: string; args: string[] }>) {
  return ((command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("ok"));
      child.emit("close", 0);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("AgentPackManager", () => {
  it("detects global installs and discovers bundled roles", async () => {
    const tempRoot = await createTempRoot("pack-manager-");
    const homeDir = path.join(tempRoot, "home");
    const bundledSkillsDir = path.join(tempRoot, PRIMARY_BUNDLED_PACK_DIR, "shared", ".agents", "skills");

    await mkdir(path.join(homeDir, ".agents", "skills", "requirements-engineer"), { recursive: true });
    await writeFile(
      path.join(homeDir, ".agents", "skills", "requirements-engineer", "SKILL.md"),
      "# role",
      "utf8",
    );
    await mkdir(path.join(bundledSkillsDir, "architect"), { recursive: true });
    await mkdir(path.join(bundledSkillsDir, "project-spec-utils"), { recursive: true });
    await writeFile(path.join(bundledSkillsDir, "architect", "SKILL.md"), "# role", "utf8");
    await writeFile(path.join(bundledSkillsDir, "project-spec-utils", "SKILL.md"), "# helper", "utf8");

    const manager = new AgentPackManager({
      cwd: tempRoot,
      homeDir,
      packRoot: path.join(tempRoot, PRIMARY_BUNDLED_PACK_DIR),
    });

    expect(await manager.isGlobalInstallPresent()).toBe(true);
    expect(await manager.discoverBundledRoles()).toEqual(["architect"]);
  });

  it("reads project config and reports parser errors in status", async () => {
    const tempRoot = await createTempRoot("pack-manager-");
    const configDir = path.join(tempRoot, ".agent_specs");

    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "agent_pack_config.yaml"), CONFIG_CONTENT, "utf8");

    const manager = new AgentPackManager({
      cwd: tempRoot,
      homeDir: path.join(tempRoot, "home"),
      packRoot: path.join(tempRoot, PRIMARY_BUNDLED_PACK_DIR),
    });

    expect((await manager.readProjectConfig(tempRoot))?.models.defaults.medium_complexity.model).toBe("gpt-5.4");

    await writeFile(path.join(configDir, "agent_pack_config.yaml"), "version: nope", "utf8");
    const status = await manager.getStatus(tempRoot);
    expect(status.projectConfigExists).toBe(true);
    expect(status.projectConfig).toBeNull();
    expect(status.projectConfigError).toBeTruthy();
  });

  it("invokes the installer with array-form spawn arguments", async () => {
    const tempRoot = await createTempRoot("pack-manager-");
    const calls: Array<{ command: string; args: string[] }> = [];

    const manager = new AgentPackManager({
      cwd: tempRoot,
      homeDir: path.join(tempRoot, "home"),
      packRoot: tempRoot,
      spawnRunner: createSpawnStub(calls),
    });

    const result = await manager.installGlobal({ copy: true });

    expect(result.exitCode).toBe(0);
    expect(calls[0]).toEqual({
      command: "bash",
      args: [path.join(tempRoot, "install.sh"), "--mode", "global", "--copy"],
    });
  });

  it("falls back to the legacy bundle directory when the primary directory is absent", async () => {
    const tempRoot = await createTempRoot("pack-manager-");
    const legacySkillsDir = path.join(tempRoot, LEGACY_BUNDLED_PACK_DIR, "shared", ".agents", "skills", "architect");

    await mkdir(legacySkillsDir, { recursive: true });
    await writeFile(path.join(legacySkillsDir, "SKILL.md"), "# role", "utf8");

    const manager = new AgentPackManager({
      cwd: tempRoot,
      homeDir: path.join(tempRoot, "home"),
    });

    expect(await manager.discoverBundledRoles()).toEqual(["architect"]);
  });
});
