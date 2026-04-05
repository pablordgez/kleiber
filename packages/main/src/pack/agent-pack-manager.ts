import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GLOBAL_PACK_DETECTION_SKILL,
  LEGACY_BUNDLED_PACK_DIR,
  PRIMARY_BUNDLED_PACK_DIR,
  type AgentPackConfig,
} from "@kleiber/shared";

import { parseAgentPackConfigYaml } from "./agent-pack-config";

export interface AgentPackManagerOptions {
  cwd?: string;
  homeDir?: string;
  packRoot?: string;
  spawnRunner?: typeof spawn;
}

export interface InstallerRunResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentPackStatus {
  bundledRoles: string[];
  globallyInstalled: boolean;
  globalDetectionPath: string;
  projectConfig: AgentPackConfig | null;
  projectConfigError: string | null;
  projectConfigExists: boolean;
  projectConfigPath: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class AgentPackManager {
  readonly #cwd: string;
  readonly #homeDir: string;
  readonly #packRoot: string;
  readonly #spawnRunner: typeof spawn;

  constructor(options: AgentPackManagerOptions = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#homeDir = options.homeDir ?? os.homedir();
    this.#packRoot = options.packRoot ?? resolveDefaultPackRoot(this.#cwd);
    this.#spawnRunner = options.spawnRunner ?? spawn;
  }

  get globalDetectionPath(): string {
    return path.join(this.#homeDir, ".agents", "skills", GLOBAL_PACK_DETECTION_SKILL, "SKILL.md");
  }

  get bundledSkillsPath(): string {
    return path.join(this.#packRoot, "shared", ".agents", "skills");
  }

  resolveProjectConfigPath(projectRoot = this.#cwd): string {
    return path.join(projectRoot, ".agent_specs", "agent_pack_config.yaml");
  }

  async isGlobalInstallPresent(): Promise<boolean> {
    return pathExists(this.globalDetectionPath);
  }

  async discoverBundledRoles(): Promise<string[]> {
    if (!(await pathExists(this.bundledSkillsPath))) {
      return [];
    }

    const entries = await readdir(this.bundledSkillsPath, { withFileTypes: true });
    const roles = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== "project-spec-utils")
        .map(async (entry) => {
          const skillPath = path.join(this.bundledSkillsPath, entry.name, "SKILL.md");
          return (await pathExists(skillPath)) ? entry.name : null;
        }),
    );

    return roles.filter((role): role is string => role !== null).sort((left, right) => left.localeCompare(right));
  }

  async readProjectConfig(projectRoot = this.#cwd): Promise<AgentPackConfig | null> {
    const configPath = this.resolveProjectConfigPath(projectRoot);
    if (!(await pathExists(configPath))) {
      return null;
    }

    return parseAgentPackConfigYaml(await readFile(configPath, "utf8"));
  }

  async getStatus(projectRoot = this.#cwd): Promise<AgentPackStatus> {
    const projectConfigPath = this.resolveProjectConfigPath(projectRoot);
    const projectConfigExists = await pathExists(projectConfigPath);

    try {
      return {
        bundledRoles: await this.discoverBundledRoles(),
        globallyInstalled: await this.isGlobalInstallPresent(),
        globalDetectionPath: this.globalDetectionPath,
        projectConfig: await this.readProjectConfig(projectRoot),
        projectConfigError: null,
        projectConfigExists,
        projectConfigPath,
      };
    } catch (error) {
      return {
        bundledRoles: await this.discoverBundledRoles(),
        globallyInstalled: await this.isGlobalInstallPresent(),
        globalDetectionPath: this.globalDetectionPath,
        projectConfig: null,
        projectConfigError: error instanceof Error ? error.message : String(error),
        projectConfigExists,
        projectConfigPath,
      };
    }
  }

  async installGlobal(options: { copy?: boolean } = {}): Promise<InstallerRunResult> {
    const invocation = this.#resolveInstallerInvocation(options);

    return new Promise<InstallerRunResult>((resolve, reject) => {
      const child = this.#spawnRunner(invocation.command, invocation.args, {
        cwd: this.#packRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", reject);
      child.on("close", (exitCode) => {
        resolve({
          command: invocation.command,
          args: invocation.args,
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }

  #resolveInstallerInvocation(options: { copy?: boolean }): { command: string; args: string[] } {
    if (process.platform === "win32") {
      const args = [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(this.#packRoot, "install.ps1"),
        "--mode",
        "global",
      ];
      if (options.copy) {
        args.push("--copy");
      }

      return { command: "powershell.exe", args };
    }

    const scriptName = process.platform === "darwin" ? "install_macos.sh" : "install.sh";
    const args = [path.join(this.#packRoot, scriptName), "--mode", "global"];
    if (options.copy) {
      args.push("--copy");
    }

    return { command: "bash", args };
  }
}

function resolveDefaultPackRoot(cwd: string): string {
  const primaryPackRoot = path.resolve(cwd, PRIMARY_BUNDLED_PACK_DIR);
  if (existsSync(primaryPackRoot)) {
    return primaryPackRoot;
  }

  return path.resolve(cwd, LEGACY_BUNDLED_PACK_DIR);
}
