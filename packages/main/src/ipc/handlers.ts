import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ipcMain, BrowserWindow } from "electron";
import { IPC_CHANNELS, SUPPORTED_AGENT_CLIS } from "@kleiber/shared";
import log from "electron-log";
import type { AgentCli, AgentPackConfig, AppSettings, Project, Session, SessionType } from "@kleiber/shared";
import { McpOrchestrator, createMcpSocketBridgeServer } from "../mcp";
import type { ParentToWrapperResponse, WrapperToParentRequest } from "../mcp";
import { RemoteApiServerController } from "../api/server";
import type { RemoteApiPackManager, RemoteApiStore } from "../api/types";
import { SessionManager, type McpLaunchConfig } from "../sessions/session-manager";
import { AgentPackManager } from "../pack/agent-pack-manager";
import { resolveHarnessAdapter } from "../pack/harness-adapter";
import { notifySessionExitIfUnfocused } from "../notifications";

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
      mcp_injection: "argv",
    },
    claude_code: {
      enabled: true,
      orchestration: "native_subagents_or_agent_teams",
      launch_command: "claude",
      mcp_injection: "env",
    },
    opencode: {
      enabled: true,
      orchestration: "plugin_or_manual",
      launch_command: "opencode",
      mcp_injection: "env",
    },
    gemini_cli: {
      enabled: true,
      orchestration: "experimental_subagents",
      launch_command: "gemini",
      mcp_injection: "env",
    },
  },
  mcp: {
    available: ["kleiber-local"],
    notes: [],
  },
  agent_overrides: {
    codex: {
      mcp_args_template: [
        "-c",
        "mcp_servers.kleiber.command={wrapperCommandJson}",
        "-c",
        "mcp_servers.kleiber.args={wrapperArgsJson}",
        "-c",
        "mcp_servers.kleiber.env.KLEIBER_SESSION_ID={sessionId}",
        "-c",
        "mcp_servers.kleiber.env.KLEIBER_PROJECT_ID={projectId}",
        "-c",
        "mcp_servers.kleiber.env.KLEIBER_MCP_SOCKET_PATH={mcpSocketPath}",
      ],
    },
    opencode: {
      mcp_env_template: {
        OPENCODE_CONFIG_CONTENT:
          '{"$schema":"https://opencode.ai/config.json","mcp":{"kleiber":{"type":"local","enabled":true,"command":{wrapperCommandAndArgsJson},"environment":{"KLEIBER_SESSION_ID":"{sessionId}","KLEIBER_PROJECT_ID":"{projectId}","KLEIBER_MCP_SOCKET_PATH":"{mcpSocketPath}"}}}}',
      },
    },
  },
};

const mcpWrapperScriptPath = path.resolve(__dirname, "../mcp/stdio-wrapper.js");

export const sessionManager = new SessionManager({
  mcpWrapperFactory: ({ sessionId }) =>
    createMcpSocketBridgeServer({
      sessionId,
      onRequest: async (message: WrapperToParentRequest): Promise<ParentToWrapperResponse> => {
        const response: ParentToWrapperResponse = {
          kind: "kleiber.mcp.response",
          requestId: message.requestId,
          ok: true,
        };

        try {
          response.result = await mcpOrchestrator.handleParentRequest({
            method: message.method,
            params: message.params,
            context: message.context,
          });
        } catch (error) {
          response.ok = false;
          response.error = {
            message: error instanceof Error ? error.message : String(error),
          };
        }

        return response;
      },
    }),
});

const mcpOrchestrator = new McpOrchestrator({
  sessionManager,
  store,
  packManager: agentPackManager,
  defaultPackConfig: DEFAULT_PACK_CONFIG,
});

const remoteApiServer = new RemoteApiServerController({
  store,
  packManager: agentPackManager,
  sessionManager,
  createSessionResolver: resolveSessionCreateOptions,
  mcpRuntime: {
    wrapperCommand: process.execPath,
    wrapperArgs: [mcpWrapperScriptPath],
  },
});

// IPC output batching: accumulate PTY chunks for up to 16 ms before sending to
// the renderer.  This prevents flooding the IPC channel on high-throughput
// sessions while keeping perceived latency well below one frame.
const OUTPUT_BATCH_INTERVAL_MS = 16;
const OUTPUT_BATCH_MAX_BYTES = 64 * 1024;

interface OutputBatch {
  data: string;
  timer: ReturnType<typeof setTimeout>;
}

const outputBatches = new Map<string, OutputBatch>();

function flushOutputBatch(sessionId: string): void {
  const batch = outputBatches.get(sessionId);
  if (!batch) return;
  outputBatches.delete(sessionId);
  const data = batch.data;
  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    windowInstance.webContents.send(`terminals:output:${sessionId}`, data);
  });
}

sessionManager.on("session-output", (payload) => {
  const existing = outputBatches.get(payload.sessionId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.data += payload.chunk;
    if (existing.data.length >= OUTPUT_BATCH_MAX_BYTES) {
      flushOutputBatch(payload.sessionId);
      return;
    }
    existing.timer = setTimeout(() => flushOutputBatch(payload.sessionId), OUTPUT_BATCH_INTERVAL_MS);
  } else {
    const timer = setTimeout(() => flushOutputBatch(payload.sessionId), OUTPUT_BATCH_INTERVAL_MS);
    outputBatches.set(payload.sessionId, { data: payload.chunk, timer });
  }
});
sessionManager.on("session-exited", (payload) => {
  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    windowInstance.webContents.send(`terminals:exit:${payload.session.id}`, payload.session.exitCode);
    windowInstance.webContents.send(IPC_CHANNELS.sessions.updated, payload.session);
  });
  notifySessionExitIfUnfocused(payload, BrowserWindow.getAllWindows());
});
sessionManager.on("session-created", (payload) => {
  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    windowInstance.webContents.send(IPC_CHANNELS.sessions.updated, payload.session);
  });
});
sessionManager.on("session-updated", (payload) => {
  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    windowInstance.webContents.send(IPC_CHANNELS.sessions.updated, payload.session);
  });
});

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
  mcpEnabled?: boolean;
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

function readStringArrayOverride(source: Record<string, unknown>, keys: string[]): string[] | null {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      return value as string[];
    }
  }

  return null;
}

function readStringRecordOverride(source: Record<string, unknown>, keys: string[]): Record<string, string> | null {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.every(([, entry]) => typeof entry === "string")) {
        return Object.fromEntries(entries) as Record<string, string>;
      }
    }
  }

  return null;
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
    storeInstance: Pick<RemoteApiStore, "getProject">;
    packManager: Pick<RemoteApiPackManager, "readProjectConfig">;
    mcpRuntime?: {
      wrapperCommand: string;
      wrapperArgs: string[];
    };
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
    mcpEnabled?: boolean;
    mcpLaunchConfig?: McpLaunchConfig | null;
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
    mcpEnabled?: boolean;
    mcpLaunchConfig?: McpLaunchConfig | null;
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
  const requestedMcpEnabled = payload.mcpEnabled ?? true;
  const mcpLaunchConfig = requestedMcpEnabled
    ? resolveMcpLaunchConfig(adapter.mcpInjection, override, options.mcpRuntime)
    : null;
  createSessionInput.launch = {
    command: adapter.launchCommand,
    args: launchArgs,
    env: role ? { KLEIBER_AGENT_ROLE: role } : {},
  };
  createSessionInput.mcpEnabled = Boolean(mcpLaunchConfig);
  createSessionInput.mcpLaunchConfig = mcpLaunchConfig;

  return { project, createSessionInput };
}

function resolveMcpLaunchConfig(
  injectionMethod: "env" | "argv" | "stdio" | "none" | "unknown" | null,
  override: Record<string, unknown>,
  runtime: { wrapperCommand: string; wrapperArgs: string[] } | undefined,
): McpLaunchConfig | null {
  if (!runtime || !injectionMethod || injectionMethod === "none" || injectionMethod === "unknown") {
    return null;
  }

  const argsTemplate = readStringArrayOverride(override, ["mcp_args_template", "mcpArgsTemplate"]);
  const envTemplate = readStringRecordOverride(override, ["mcp_env_template", "mcpEnvTemplate"]) ?? {};

  if (injectionMethod === "argv" && !argsTemplate) {
    return null;
  }

  return {
    injectionMethod,
    wrapperCommand: runtime.wrapperCommand,
    wrapperArgs: runtime.wrapperArgs,
    ...(argsTemplate ? { argsTemplate } : {}),
    envTemplate,
  };
}

export function registerIpcHandlers(): void {
  void remoteApiServer.syncWithSettings().catch((error) => {
    log.error("Failed to initialize remote API server", error);
  });

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
          mcpRuntime: {
            wrapperCommand: process.execPath,
            wrapperArgs: [mcpWrapperScriptPath],
          },
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
  ipcMain.handle(IPC_CHANNELS.settings.get, async (): Promise<AppSettings> => store.getSettings());
  ipcMain.handle(IPC_CHANNELS.settings.update, async (_e, data: unknown): Promise<void> => {
    const currentSettings = store.getSettings();
    const nextSettings = resolveSettingsUpdate(currentSettings, data);
    store.setSettings(nextSettings);
    await remoteApiServer.applySettings(nextSettings);
  });

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

function resolveSettingsUpdate(currentSettings: AppSettings, data: unknown): AppSettings {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Settings update payload must be an object.");
  }

  const patch = data as Partial<AppSettings>;
  const nextSettings: AppSettings = {
    ...currentSettings,
    ...patch,
  };

  if (typeof nextSettings.remoteApiEnabled !== "boolean") {
    throw new Error("remoteApiEnabled must be a boolean.");
  }

  if (
    nextSettings.remoteApiPort !== null &&
    (!Number.isInteger(nextSettings.remoteApiPort) ||
      nextSettings.remoteApiPort <= 0 ||
      nextSettings.remoteApiPort > 65_535)
  ) {
    throw new Error("remoteApiPort must be null or an integer between 1 and 65535.");
  }

  if (
    typeof nextSettings.remoteApiBindAddress !== "string" ||
    nextSettings.remoteApiBindAddress.trim().length === 0
  ) {
    throw new Error("remoteApiBindAddress must be a non-empty string.");
  }

  if (typeof nextSettings.quickLaunchShortcut !== "string") {
    throw new Error("quickLaunchShortcut must be a string.");
  }

  if (nextSettings.theme !== "dark" && nextSettings.theme !== "light") {
    throw new Error("theme must be 'dark' or 'light'.");
  }

  return {
    ...nextSettings,
    remoteApiBindAddress: nextSettings.remoteApiBindAddress.trim(),
  };
}
