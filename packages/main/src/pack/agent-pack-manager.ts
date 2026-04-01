import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { GLOBAL_PACK_DETECTION_SKILL, type AgentPackConfig } from "@kleiber/shared";

import { parseAgentPackConfigYaml } from "./agent-pack-config";

export interface AgentPackManagerOptions {
  homeDir?: string;
  cwd?: string;
  packRoot?: string;
}

export interface AgentPackStatus {
  globallyInstalled: boolean;
  globalDetectionPath: string;
  projectConfigPath: string;
  projectConfigExists: boolean;
  projectConfig: AgentPackConfig | null;
  projectConfigError: string | null;
}

export interface InstallerRunResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class AgentPackManager {
  private readonly homeDir: string;
  private readonly cwd: string;
  private readonly packRoot: string;

  constructor(options: AgentPackManagerOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    this.cwd = options.cwd ?? process.cwd();
    this.packRoot = options.packRoot ?? path.resolve(this.cwd, "coding-agent-pack");
  }

  public async getStatus(projectRoot = this.cwd): Promise<AgentPackStatus> {
    const globallyInstalled = await this.isGlobalInstallPresent();
    const projectConfigPath = this.resolveProjectConfigPath(projectRoot);
    const projectConfigExists = await pathExists(projectConfigPath);

    if (!projectConfigExists) {
      return {
        globallyInstalled,
        globalDetectionPath: this.globalDetectionPath,
        projectConfigPath,
        projectConfigExists,
        projectConfig: null,
        projectConfigError: null,
      };
    }

    try {
      const projectConfig = await this.readProjectConfig(projectRoot);
      return {
        globallyInstalled,
        globalDetectionPath: this.globalDetectionPath,
        projectConfigPath,
        projectConfigExists,
        projectConfig,
        projectConfigError: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        globallyInstalled,
        globalDetectionPath: this.globalDetectionPath,
        projectConfigPath,
        projectConfigExists,
        projectConfig: null,
        projectConfigError: message,
      };
    }
  }

  public async isGlobalInstallPresent(): Promise<boolean> {
    return pathExists(this.globalDetectionPath);
  }

  public async installGlobal(options: { copy?: boolean } = {}): Promise<InstallerRunResult> {
    const { command, args } = this.resolveInstallerInvocation(options);
    return runCommand(command, args);
  }

  public async discoverRoles(scope: "global" | "project" = "global", projectRoot = this.cwd): Promise<string[]> {
    const roleRoot =
      scope === "global"
        ? path.join(this.homeDir, ".agents", "skills")
        : path.join(projectRoot, ".agents", "skills");
    return listRoles(roleRoot);
  }

  public async readProjectConfig(projectRoot = this.cwd): Promise<AgentPackConfig> {
    const configPath = this.resolveProjectConfigPath(projectRoot);
    const content = await readFile(configPath, "utf8");
    return parseAgentPackConfigYaml(content);
  }

  private resolveProjectConfigPath(projectRoot: string): string {
    return path.join(projectRoot, ".agent_specs", "agent_pack_config.yaml");
  }

  private resolveInstallerInvocation(options: { copy?: boolean }): { command: string; args: string[] } {
    if (process.platform === "win32") {
      const args = ["-ExecutionPolicy", "Bypass", "-File", path.join(this.packRoot, "install.ps1"), "--mode", "global"];
      if (options.copy === true) {
        args.push("--copy");
      }
      return {
        command: "powershell.exe",
        args,
      };
    }

    const installerName = process.platform === "darwin" ? "install_macos.sh" : "install.sh";
    const args = [path.join(this.packRoot, installerName), "--mode", "global"];
    if (options.copy === true) {
      args.push("--copy");
    }
    return {
      command: "bash",
      args,
    };
  }

  private get globalDetectionPath(): string {
    return path.join(this.homeDir, ".agents", "skills", GLOBAL_PACK_DETECTION_SKILL, "SKILL.md");
  }
}

async function listRoles(roleRoot: string): Promise<string[]> {
  if (!(await pathExists(roleRoot))) {
    return [];
  }

  const entries = await readdir(roleRoot, { withFileTypes: true });
  const names = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const skillPath = path.join(roleRoot, entry.name, "SKILL.md");
        if (await pathExists(skillPath)) {
          return entry.name;
        }
        return null;
      }),
  );

  return names
    .filter((name): name is string => name !== null)
    .sort((left, right) => left.localeCompare(right));
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[]): Promise<InstallerRunResult> {
  return new Promise<InstallerRunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        command,
        args,
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
