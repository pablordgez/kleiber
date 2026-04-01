import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ipcMain, BrowserWindow } from "electron";
import { IPC_CHANNELS, SUPPORTED_AGENT_CLIS } from "@kleiber/shared";
import log from "electron-log";
import type { AgentCli, AgentPackConfig, Project, Session, SessionType } from "@kleiber/shared";
import { SessionManager } from "../sessions/session-manager";
import { AgentPackManager } from "../pack/agent-pack-manager";
import { resolveHarnessAdapter } from "../pack/harness-adapter";

export const sessionManager = new SessionManager();

sessionManager.on("session-output", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(`terminals:output:${payload.sessionId}`, payload.chunk));
});
sessionManager.on("session-exited", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(`terminals:exit:${payload.session.id}`, payload.session.exitCode));
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IPC_CHANNELS.sessions.updated, payload.session));
});
sessionManager.on("session-created", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IPC_CHANNELS.sessions.updated, payload.session));
});
sessionManager.on("session-updated", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IPC_CHANNELS.sessions.updated, payload.session));
});

import { PersistenceStore } from "../store";

const store = new PersistenceStore();
const agentPackManager = new AgentPackManager();

const DEFAULT_PACK_CONFIG: AgentPackConfig = {
  version: 1,
  providers: {
    allowed: ["openai", "anthropic", "google"],
    disallowed: [],
  },
  models: {
    defaults: {
      low_complexity: { provider: "openai", model: "gpt-5.4-mini" },
      medium_complexity: { provider: "openai", model: "gpt-5.4" },
      high_complexity: { provider: "openai", model: "gpt-5.4" },
    },
    notes: [],
  },
  harness_adapters: {
    codex: {
      enabled: true,
      orchestration: "native_subagents",
      launch_command: "codex",
    },
    claude_code: {
      enabled: true,
      orchestration: "native_subagents_or_agent_teams",
      launch_command: "claude",
    },
    opencode: {
      enabled: true,
      orchestration: "plugin_or_manual",
      launch_command: "opencode",
    },
    gemini_cli: {
      enabled: true,
      orchestration: "experimental_subagents",
      launch_command: "gemini",
    },
  },
  mcp: {
    available: [],
    notes: [],
  },
  agent_overrides: {},
};

const CLI_ALIASES: Readonly<Record<string, AgentCli>> = {
  "claude-code": "claude",
  claude_code: "claude",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
};

interface CreateProjectIpcPayload {
  name: string;
  directoryPath: string;
  yoloDefault?: boolean;
}

interface CreateSessionIpcPayload {
  projectId: string;
  parentSessionId?: string | null;
  name: string;
  type?: string;
  cli?: string;
  role?: string;
  yolo?: boolean;
  workingDirectory?: string;
}

function isSupportedCli(value: string): value is AgentCli {
  return (SUPPORTED_AGENT_CLIS as readonly string[]).includes(value);
}

export function normalizeCliIdentifier(value: string | null | undefined): AgentCli | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (isSupportedCli(normalized)) {
    return normalized;
  }

  return CLI_ALIASES[normalized] ?? null;
}

function normalizeSessionType(
  type: string | undefined,
  cli: AgentCli | null,
  role: string | null,
): SessionType {
  const normalized = type?.trim().toLowerCase();
  if (normalized === "plain" || normalized === "agent" || normalized === "agent_role") {
    return normalized;
  }

  if (!cli) {
    return "plain";
  }

  return role ? "agent_role" : "agent";
}

function resolveAgentOverride(
  config: AgentPackConfig,
  harnessName: string,
): Record<string, unknown> {
  const entry = config.agent_overrides[harnessName];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {};
  }

  return entry as Record<string, unknown>;
}

function addRoleLaunchArgs(
  args: string[],
  override: Record<string, unknown>,
  role: string,
): void {
  const roleFlag =
    typeof override.role_flag === "string"
      ? override.role_flag
      : typeof override.roleFlag === "string"
        ? override.roleFlag
        : null;
  if (roleFlag) {
    args.push(roleFlag, role);
    return;
  }

  const roleTemplate =
    Array.isArray(override.role_args_template) && override.role_args_template.every((value) => typeof value === "string")
      ? (override.role_args_template as string[])
      : Array.isArray(override.roleArgsTemplate) && override.roleArgsTemplate.every((value) => typeof value === "string")
        ? (override.roleArgsTemplate as string[])
        : null;
  if (roleTemplate) {
    args.push(...roleTemplate.map((entry) => entry.replaceAll("{role}", role)));
    return;
  }

  const roleAsPositional =
    override.role_as_positional === true || override.roleAsPositional === true;
  if (roleAsPositional) {
    args.push(role);
  }
}

export async function resolveSessionCreateOptions(
  payload: CreateSessionIpcPayload,
  options: {
    storeInstance: Pick<PersistenceStore, "getProject">;
    packManager: Pick<AgentPackManager, "readProjectConfig">;
  },
): Promise<{
  project: Project;
  createSessionInput: {
    projectId: string;
    parentSessionId: string | null;
    type: SessionType;
    cli: AgentCli | null;
    role: string | null;
    requestedYolo?: boolean;
    defaultYolo: boolean;
    name: string;
    workingDirectory: string;
    launch?: {
      command: string;
      args: string[];
      env: NodeJS.ProcessEnv;
    };
  };
}> {
  const project = options.storeInstance.getProject(payload.projectId);
  if (!project) {
    throw new Error(`Project ${payload.projectId} not found`);
  }

  const normalizedCli = normalizeCliIdentifier(payload.cli);
  const role = payload.role?.trim() ? payload.role.trim() : null;
  const type = normalizeSessionType(payload.type, normalizedCli, role);
  const workingDirectory = path.resolve(payload.workingDirectory ?? project.directoryPath);

  const createSessionInput: {
    projectId: string;
    parentSessionId: string | null;
    type: SessionType;
    cli: AgentCli | null;
    role: string | null;
    requestedYolo?: boolean;
    defaultYolo: boolean;
    name: string;
    workingDirectory: string;
    launch?: {
      command: string;
      args: string[];
      env: NodeJS.ProcessEnv;
    };
  } = {
    projectId: payload.projectId,
    parentSessionId: payload.parentSessionId ?? null,
    type,
    cli: normalizedCli,
    role,
    ...(payload.yolo !== undefined ? { requestedYolo: payload.yolo } : {}),
    defaultYolo: project.yoloDefault,
    name: payload.name,
    workingDirectory,
  };

  if (type === "plain") {
    return { project, createSessionInput };
  }

  if (!normalizedCli) {
    throw new Error("Agent sessions require a supported CLI identifier.");
  }

  const packConfig =
    (await options.packManager.readProjectConfig(project.directoryPath)) ?? DEFAULT_PACK_CONFIG;
  const adapter = resolveHarnessAdapter(packConfig, normalizedCli);
  if (!adapter.enabled) {
    throw new Error(`CLI "${normalizedCli}" is disabled in agent_pack_config.yaml.`);
  }

  const canonicalCli = normalizeCliIdentifier(adapter.launchCommand) ?? normalizedCli;
  const override = resolveAgentOverride(packConfig, adapter.harnessName);
  const launchArgs: string[] = [];

  if (role) {
    addRoleLaunchArgs(launchArgs, override, role);
  }

  if (payload.yolo === true && adapter.yoloFlag) {
    launchArgs.push(adapter.yoloFlag);
  }

  createSessionInput.cli = canonicalCli;
  createSessionInput.launch = {
    command: adapter.launchCommand,
    args: launchArgs,
    env: role ? { KLEIBER_AGENT_ROLE: role } : {},
  };

  return { project, createSessionInput };
}

export function registerIpcHandlers(): void {
  // --- Projects ---
  ipcMain.handle(IPC_CHANNELS.projects.list, async (): Promise<Project[]> => {
    log.debug("IPC: projects:list");
    return store.listProjects();
  });

  ipcMain.handle(
    IPC_CHANNELS.projects.create,
    async (_e, data: CreateProjectIpcPayload): Promise<Project> => {
      log.debug("IPC: projects:create", data);
      const directoryPath = path.resolve(data.directoryPath);
      await mkdir(directoryPath, { recursive: true });
      return store.saveProject({
        id: crypto.randomUUID(),
        name: data.name,
        directoryPath,
        yoloDefault: data.yoloDefault ?? false,
        createdAt: new Date().toISOString(),
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.projects.remove, async (_e, id: string): Promise<void> => {
    log.debug("IPC: projects:remove", id);
    store.removeProject(id);
  });

  ipcMain.handle(IPC_CHANNELS.projects.update, async (_e, id: string, data: Partial<Pick<Project, "name" | "yoloDefault">>): Promise<void> => {
    log.debug("IPC: projects:update", id, data);
    const project = store.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    store.saveProject({ ...project, ...data });
  });

  // --- Sessions ---
  ipcMain.handle(IPC_CHANNELS.sessions.list, async (_e, projectId: string): Promise<Session[]> => {
    return sessionManager.listSessions(projectId) as unknown as Session[];
  });

  ipcMain.handle(
    IPC_CHANNELS.sessions.create,
    async (_e, data: CreateSessionIpcPayload): Promise<Session> => {
      try {
        const { createSessionInput } = await resolveSessionCreateOptions(data, {
          storeInstance: store,
          packManager: agentPackManager,
        });
        const session = await sessionManager.createSession(createSessionInput);
        return session as unknown as Session;
      } catch (e: any) {
        log.error("Failed to create session", e);
        // CLI not found or other error
        throw e;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.sessions.rename, async (_e, id: string, name: string): Promise<void> => {
    try {
      sessionManager.renameSession(id, name);
    } catch (e) {
      log.error(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessions.send, async (_e, id: string, input: string): Promise<void> => {
    try {
      sessionManager.sendToSession(id, input);
    } catch (e) {
      log.error(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessions.read, async (_e, id: string, limit?: number): Promise<string[]> => {
    try {
      const options: any = { plainText: false };
      if (limit !== undefined) options.limit = limit;
      return sessionManager.readSession(id, options);
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessions.kill, async (_e, id: string): Promise<void> => {
    try {
      sessionManager.killSession(id);
    } catch (e) {
      log.error(e);
    }
  });

  // --- Settings ---
  ipcMain.handle(IPC_CHANNELS.settings.get, async () => ({
    remoteApiEnabled: false, remoteApiPort: null, remoteApiBindAddress: "0.0.0.0", theme: "dark", quickLaunchShortcut: "CmdOrCtrl+K"
  }));
  ipcMain.handle(IPC_CHANNELS.settings.update, async (_e, data: unknown): Promise<void> => {});

  // --- Pack ---
  ipcMain.handle(IPC_CHANNELS.pack.status, async (_e, projectId?: string) => {
    const projectRoot = projectId ? store.getProject(projectId)?.directoryPath : undefined;
    const status = await agentPackManager.getStatus(projectRoot);
    return {
      installed: status.globallyInstalled,
      globallyInstalled: status.globallyInstalled,
      bundledRoles: status.bundledRoles,
      globalDetectionPath: status.globalDetectionPath,
      projectConfigPath: status.projectConfigPath,
      projectConfigExists: status.projectConfigExists,
      projectConfigError: status.projectConfigError,
    };
  });
  ipcMain.handle(IPC_CHANNELS.pack.install, async (): Promise<void> => {
    const result = await agentPackManager.installGlobal();
    if (result.exitCode !== 0) {
      throw new Error(
        `Agent pack install failed with exit code ${String(result.exitCode)}: ${result.stderr || result.stdout}`,
      );
    }
  });
  ipcMain.handle(IPC_CHANNELS.pack.roles, async (): Promise<string[]> => {
    return agentPackManager.discoverBundledRoles();
  });

  // --- Terminals ---
  ipcMain.handle(
    IPC_CHANNELS.terminals.resize,
    async (_e, sessionId: string, cols: number, rows: number): Promise<void> => {
      try {
        sessionManager.resizeSession(sessionId, { columns: cols, rows });
      } catch (e) {
        log.error(e);
      }
    }
  );
}
