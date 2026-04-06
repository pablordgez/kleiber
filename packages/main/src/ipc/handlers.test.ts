import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type AgentPackConfig, type Project } from "@kleiber/shared";
import log from "electron-log";

const mockState = vi.hoisted(() => {
  return {
    registeredHandlers: new Map<string, (...args: any[]) => Promise<unknown>>(),
    projects: new Map<string, Project>(),
    onSessionEventMock: vi.fn(),
    listSessionsMock: vi.fn(() => []),
    createSessionMock: vi.fn(),
    renameSessionMock: vi.fn(),
    sendSessionMock: vi.fn(),
    readSessionMock: vi.fn(() => []),
    killSessionMock: vi.fn(),
    deleteSessionMock: vi.fn(),
    resizeSessionMock: vi.fn(),
    listProjectsMock: vi.fn(() => []),
    getProjectMock: vi.fn(),
    saveProjectMock: vi.fn(),
    removeProjectMock: vi.fn(() => true),
    getSettingsMock: vi.fn(() => ({
      remoteApiEnabled: false,
      remoteApiPort: null,
      remoteApiBindAddress: "0.0.0.0",
      theme: "dark",
      quickLaunchShortcut: "",
    })),
    setSettingsMock: vi.fn(),
    getRemoteApiCredentialsMock: vi.fn(() => null),
    setRemoteApiCredentialsMock: vi.fn(),
    clearRemoteApiCredentialsMock: vi.fn(),
    readProjectConfigMock: vi.fn(async () => null as AgentPackConfig | null),
    discoverBundledRolesMock: vi.fn(async () => ["architect", "task-planner"]),
    getPackStatusMock: vi.fn(async () => ({
      bundledRoles: ["architect"],
      globallyInstalled: true,
      globalDetectionPath: "/tmp/.agents/skills/requirements-engineer/SKILL.md",
      projectConfig: null,
      projectConfigError: null,
      projectConfigExists: false,
      projectConfigPath: "/tmp/project/.agent_specs/agent_pack_config.yaml",
    })),
    installGlobalMock: vi.fn(async () => ({
      command: "bash",
      args: [],
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    })),
    notifySessionExitIfUnfocusedMock: vi.fn(),
    showOpenDialogMock: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    globalShortcutRegisterMock: vi.fn(() => true),
    globalShortcutUnregisterMock: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      mockState.registeredHandlers.set(channel, handler);
    },
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: (...args: any[]) => mockState.showOpenDialogMock(...args),
  },
  globalShortcut: {
    register: (...args: any[]) => mockState.globalShortcutRegisterMock(...args),
    unregister: (...args: any[]) => mockState.globalShortcutUnregisterMock(...args),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../sessions/session-manager", () => {
  class SessionManagerMock {
    on = mockState.onSessionEventMock;
    listSessions = mockState.listSessionsMock;
    createSession = mockState.createSessionMock;
    renameSession = mockState.renameSessionMock;
    sendToSession = mockState.sendSessionMock;
    readSession = mockState.readSessionMock;
    killSession = mockState.killSessionMock;
    deleteSession = mockState.deleteSessionMock;
    resizeSession = mockState.resizeSessionMock;
  }

  return { SessionManager: SessionManagerMock };
});

vi.mock("../store", () => {
  class PersistenceStoreMock {
    listProjects = mockState.listProjectsMock;
    getProject = mockState.getProjectMock;
    saveProject = mockState.saveProjectMock;
    removeProject = mockState.removeProjectMock;
    getSettings = mockState.getSettingsMock;
    setSettings = mockState.setSettingsMock;
    getRemoteApiCredentials = mockState.getRemoteApiCredentialsMock;
    setRemoteApiCredentials = mockState.setRemoteApiCredentialsMock;
    clearRemoteApiCredentials = mockState.clearRemoteApiCredentialsMock;
  }

  return { PersistenceStore: PersistenceStoreMock };
});

vi.mock("../pack/agent-pack-manager", () => {
  class AgentPackManagerMock {
    readProjectConfig = mockState.readProjectConfigMock;
    discoverBundledRoles = mockState.discoverBundledRolesMock;
    getStatus = mockState.getPackStatusMock;
    installGlobal = mockState.installGlobalMock;
  }

  return { AgentPackManager: AgentPackManagerMock };
});

vi.mock("../notifications", () => ({
  notifySessionExitIfUnfocused: mockState.notifySessionExitIfUnfocusedMock,
}));

function buildPackConfig(overrides: Partial<AgentPackConfig>): AgentPackConfig {
  return {
    version: 1,
    providers: {
      allowed: ["openai"],
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
    ...overrides,
  };
}

describe("IPC handlers remediation", () => {
  beforeEach(() => {
    mockState.registeredHandlers.clear();
    mockState.projects.clear();

    (mockState.listSessionsMock as any).mockReset().mockReturnValue([]);
    mockState.createSessionMock.mockReset().mockResolvedValue({
      id: "session-1",
      name: "Session 1",
      projectId: "project-1",
      parentSessionId: null,
      type: "plain",
      cli: null,
      role: null,
      yolo: false,
      state: "running",
      exitCode: null,
      pid: 1000,
      outputBuffer: [],
      mcpEnabled: false,
      mcpWrapperId: null,
      childSessionIds: [],
      signal: null,
    });
    mockState.renameSessionMock.mockReset();
    mockState.sendSessionMock.mockReset();
    mockState.readSessionMock.mockReset().mockReturnValue([]);
    mockState.killSessionMock.mockReset();
    mockState.deleteSessionMock.mockReset();
    mockState.resizeSessionMock.mockReset();

    (mockState.listProjectsMock as any)
      .mockReset()
      .mockImplementation(() => [...mockState.projects.values()]);
    mockState.getProjectMock.mockReset().mockImplementation((projectId: string) => mockState.projects.get(projectId));
    mockState.saveProjectMock.mockReset().mockImplementation((project: Project) => {
      mockState.projects.set(project.id, project);
      return project;
    });
    mockState.removeProjectMock.mockReset().mockReturnValue(true);

    mockState.readProjectConfigMock.mockReset().mockResolvedValue(null);
    mockState.discoverBundledRolesMock.mockReset().mockResolvedValue(["architect", "task-planner"]);
    mockState.getPackStatusMock.mockReset().mockResolvedValue({
      bundledRoles: ["architect"],
      globallyInstalled: true,
      globalDetectionPath: "/tmp/.agents/skills/requirements-engineer/SKILL.md",
      projectConfig: null,
      projectConfigError: null,
      projectConfigExists: false,
      projectConfigPath: "/tmp/project/.agent_specs/agent_pack_config.yaml",
    });
    mockState.installGlobalMock.mockReset().mockResolvedValue({
      command: "bash",
      args: [],
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    mockState.getRemoteApiCredentialsMock.mockReset().mockReturnValue(null);
    mockState.setRemoteApiCredentialsMock.mockReset();
    mockState.clearRemoteApiCredentialsMock.mockReset();
    mockState.notifySessionExitIfUnfocusedMock.mockReset();
    mockState.showOpenDialogMock.mockReset().mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    mockState.globalShortcutRegisterMock.mockReset().mockReturnValue(true);
    mockState.globalShortcutUnregisterMock.mockReset();
    vi.mocked(log.error).mockClear();
  });

  it("creates project directories when missing and stores an absolute path", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "kleiber-project-"));
    const requestedDir = path.join(projectRoot, "nested", "alpha");
    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.projects.create);

    const createdProject = (await handler?.({}, {
      name: "Alpha",
      directoryPath: requestedDir,
      yoloDefault: true,
    })) as Project;

    const dirStats = await stat(requestedDir);
    expect(dirStats.isDirectory()).toBe(true);

    const savedProject = mockState.saveProjectMock.mock.calls.at(-1)?.[0] as Project;
    expect(savedProject.directoryPath).toBe(path.resolve(requestedDir));
    expect(createdProject.directoryPath).toBe(path.resolve(requestedDir));
  });

  it("returns the selected absolute project directory from the picker IPC", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const requestedDir = path.join("tmp", "kleiber-picked-project");
    mockState.showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: [requestedDir],
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.projects.pickDirectory);
    await expect(handler?.({})).resolves.toBe(path.resolve(requestedDir));
  });

  it("defaults session workingDirectory to project root and forwards parentSessionId", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-session-"));
    mockState.projects.set("project-1", {
      id: "project-1",
      name: "Project 1",
      directoryPath: projectDir,
      yoloDefault: true,
      createdAt: new Date().toISOString(),
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await handler?.({}, {
      projectId: "project-1",
      parentSessionId: "parent-session-1",
      name: "Child Session",
      type: "plain",
    });

    const createInput = mockState.createSessionMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(createInput.workingDirectory).toBe(projectDir);
    expect(createInput.parentSessionId).toBe("parent-session-1");
    expect(createInput.defaultYolo).toBe(false);
    expect(createInput.launch).toBeUndefined();
  });

  it("resolves agent launch options from project config and normalizes CLI aliases", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-agent-"));
    mockState.projects.set("project-2", {
      id: "project-2",
      name: "Project 2",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    mockState.readProjectConfigMock.mockResolvedValue(
      buildPackConfig({
        harness_adapters: {
          claude_code: {
            enabled: true,
            orchestration: "native_subagents_or_agent_teams",
            launch_command: "claude",
            yolo_flag: "--dangerously-skip-permissions",
          },
        },
      }),
    );

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await handler?.({}, {
      projectId: "project-2",
      name: "Architect",
      type: "agent_role",
      cli: "claude-code",
      role: "architect",
      yolo: true,
    });

    expect(mockState.readProjectConfigMock).toHaveBeenCalledWith(projectDir);
    const createInput = mockState.createSessionMock.mock.calls.at(-1)?.[0] as Record<string, any>;

    expect(createInput.cli).toBe("claude");
    expect(createInput.role).toBe("architect");
    expect(createInput.launch.command).toBe("claude");
    expect(createInput.launch.args).toEqual(["--dangerously-skip-permissions"]);
    expect(createInput.launch.env).toEqual({ KLEIBER_AGENT_ROLE: "architect" });
  });

  it("bootstraps Codex harness + agent sessions with an initial prompt when no role flag exists", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-codex-agent-"));
    mockState.projects.set("project-codex-agent", {
      id: "project-codex-agent",
      name: "Project Codex Agent",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await handler?.({}, {
      projectId: "project-codex-agent",
      name: "Architect",
      type: "agent_role",
      cli: "codex",
      role: "architect",
    });

    const createInput = mockState.createSessionMock.mock.calls.at(-1)?.[0] as Record<string, any>;
    expect(createInput.launch.command).toBe("codex");
    expect(createInput.launch.args).toEqual([]);
    expect(createInput.launch.env).toEqual({ KLEIBER_AGENT_ROLE: "architect" });
    expect(createInput.launch.prompt).toContain("architect role from kleiber-agents");
    expect(createInput.launch.prompt).toContain("Kleiber session orchestration may be available");
    expect(createInput.launch.prompt).toContain(".agents/skills/project-spec-utils/references/kleiber-ecosystem.md");
    expect(createInput.launch.prompt).toContain(".codex/agents/architect.toml");
  });

  it("builds inline Codex MCP config for agent sessions", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-codex-mcp-"));
    mockState.projects.set("project-codex", {
      id: "project-codex",
      name: "Project Codex",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await handler?.({}, {
      projectId: "project-codex",
      name: "Codex MCP",
      type: "agent",
      cli: "codex",
    });

    const createInput = mockState.createSessionMock.mock.calls.at(-1)?.[0] as Record<string, any>;
    expect(createInput.cli).toBe("codex");
    expect(createInput.mcpEnabled).toBe(true);
    expect(createInput.mcpLaunchConfig).toMatchObject({
      injectionMethod: "argv",
      wrapperCommand: process.execPath,
    });
    expect(createInput.mcpLaunchConfig.argsTemplate).toEqual([
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
      "-c",
      "mcp_servers.kleiber.env.KLEIBER_MCP_DEBUG_LOG_PATH={mcpDebugLogPathJson}",
      "-c",
      'mcp_servers.kleiber.env.ELECTRON_RUN_AS_NODE="1"',
    ]);
  });

  it("builds inline OpenCode MCP config for agent sessions", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-opencode-mcp-"));
    mockState.projects.set("project-opencode", {
      id: "project-opencode",
      name: "Project OpenCode",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await handler?.({}, {
      projectId: "project-opencode",
      name: "OpenCode MCP",
      type: "agent",
      cli: "opencode",
    });

    const createInput = mockState.createSessionMock.mock.calls.at(-1)?.[0] as Record<string, any>;
    expect(createInput.cli).toBe("opencode");
    expect(createInput.mcpEnabled).toBe(true);
    expect(createInput.mcpLaunchConfig).toMatchObject({
      injectionMethod: "env",
      wrapperCommand: process.execPath,
      envTemplate: {
        OPENCODE_CONFIG_CONTENT: expect.stringContaining('"type":"local"'),
      },
    });
    expect(createInput.mcpLaunchConfig.envTemplate.OPENCODE_CONFIG_CONTENT).toContain("{wrapperCommandAndArgsJson}");
    expect(createInput.mcpLaunchConfig.envTemplate.OPENCODE_CONFIG_CONTENT).toContain("{mcpSocketPath}");
    expect(createInput.mcpLaunchConfig.envTemplate.OPENCODE_CONFIG_CONTENT).toContain("{mcpDebugLogPath}");
    expect(createInput.mcpLaunchConfig.envTemplate.OPENCODE_CONFIG_CONTENT).toContain("ELECTRON_RUN_AS_NODE");
  });

  it("builds Gemini MCP config-file injection for agent sessions", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-gemini-mcp-"));
    mockState.projects.set("project-gemini", {
      id: "project-gemini",
      name: "Project Gemini",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await handler?.({}, {
      projectId: "project-gemini",
      name: "Gemini MCP",
      type: "agent",
      cli: "gemini",
    });

    const createInput = mockState.createSessionMock.mock.calls.at(-1)?.[0] as Record<string, any>;
    expect(createInput.cli).toBe("gemini");
    expect(createInput.mcpEnabled).toBe(true);
    expect(createInput.mcpLaunchConfig).toMatchObject({
      injectionMethod: "env",
      wrapperCommand: process.execPath,
      envTemplate: {
        GEMINI_CLI_SYSTEM_SETTINGS_PATH: "{mcpConfigPath}",
      },
      configFileName: "gemini-settings.json",
    });
    expect(createInput.mcpLaunchConfig.configContentTemplate).toContain('"mcpServers"');
    expect(createInput.mcpLaunchConfig.configContentTemplate).toContain("{mcpDebugLogPath}");
    expect(createInput.mcpLaunchConfig.configContentTemplate).toContain("ELECTRON_RUN_AS_NODE");
  });

  it("allows MCP to be disabled per session even when the harness supports it", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-mcp-disabled-"));
    mockState.projects.set("project-mcp-off", {
      id: "project-mcp-off",
      name: "Project MCP Off",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    mockState.readProjectConfigMock.mockResolvedValue(
      buildPackConfig({
        harness_adapters: {
          claude_code: {
            enabled: true,
            orchestration: "native_subagents_or_agent_teams",
            launch_command: "claude",
            mcp_injection: "env",
          },
        },
      }),
    );

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await handler?.({}, {
      projectId: "project-mcp-off",
      name: "No MCP Session",
      type: "agent",
      cli: "claude",
      mcpEnabled: false,
    });

    const createInput = mockState.createSessionMock.mock.calls.at(-1)?.[0] as Record<string, any>;
    expect(createInput.mcpEnabled).toBe(false);
    expect(createInput.mcpLaunchConfig).toBeNull();
  });

  it("rejects agent session creation when the CLI is disabled in project config", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-disabled-"));
    mockState.projects.set("project-3", {
      id: "project-3",
      name: "Project 3",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    mockState.readProjectConfigMock.mockResolvedValue(
      buildPackConfig({
        harness_adapters: {
          codex: {
            enabled: false,
            orchestration: "native_subagents",
            launch_command: "codex",
          },
        },
      }),
    );

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.create);
    await expect(
      handler?.({}, {
        projectId: "project-3",
        name: "Disabled CLI",
        type: "agent",
        cli: "codex",
      }),
    ).rejects.toThrow(/disabled/);

    expect(mockState.createSessionMock).not.toHaveBeenCalled();
  });

  it("returns real pack status and bundled roles through IPC", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-pack-"));
    mockState.projects.set("project-4", {
      id: "project-4",
      name: "Project 4",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    const statusHandler = mockState.registeredHandlers.get(IPC_CHANNELS.pack.status);
    const rolesHandler = mockState.registeredHandlers.get(IPC_CHANNELS.pack.roles);

    const status = (await statusHandler?.({}, "project-4")) as Record<string, unknown>;
    const roles = (await rolesHandler?.({}, "project-4")) as string[];

    expect(status.installed).toBe(true);
    expect(status.globallyInstalled).toBe(true);
    expect(status.bundledRoles).toEqual(["architect"]);
    expect(roles).toEqual(["architect", "task-planner"]);
    expect(mockState.getPackStatusMock).toHaveBeenCalledWith(projectDir);
  });

  it("detects whether a CLI binary exists on PATH", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const binDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-bin-"));
    const commandName = process.platform === "win32" ? "codex.cmd" : "codex";
    const commandPath = path.join(binDir, commandName);
    await writeFile(commandPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
    if (process.platform !== "win32") {
      await chmod(commandPath, 0o755);
    }

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

    try {
      const handler = mockState.registeredHandlers.get(IPC_CHANNELS.pack.detectCli);
      await expect(handler?.({}, "codex")).resolves.toBe(true);
      await expect(handler?.({}, "opencode")).resolves.toBe(false);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("builds MCP argv launch config and role args templates for agent sessions", async () => {
    const { resolveSessionCreateOptions } = await import("./handlers.js");

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-agent-argv-"));
    mockState.projects.set("project-5", {
      id: "project-5",
      name: "Project 5",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    mockState.readProjectConfigMock.mockResolvedValue(
      buildPackConfig({
        harness_adapters: {
          claude_code: {
            enabled: true,
            orchestration: "native_subagents_or_agent_teams",
            launch_command: "claude",
            mcp_injection: "argv",
          },
        },
        agent_overrides: {
          claude_code: {
            role_args_template: ["--role", "{role}", "--persona={role}"],
            mcp_args_template: ["--mcp", "{wrapperCommand}", "{wrapperArgsJson}"],
            mcp_env_template: {
              MCP_SESSION: "{sessionId}",
              MCP_PROJECT: "{projectId}",
            },
          },
        },
      }),
    );

    const { project, createSessionInput } = await resolveSessionCreateOptions(
      {
        projectId: "project-5",
        name: "Architect",
        type: "agent_role",
        cli: "claude-code",
        role: "architect",
        yolo: false,
        workingDirectory: path.join(projectDir, "workspace"),
      },
      {
        storeInstance: { getProject: mockState.getProjectMock },
        packManager: { readProjectConfig: mockState.readProjectConfigMock },
        mcpRuntime: {
          wrapperCommand: process.execPath,
          wrapperArgs: ["/tmp/wrapper.js"],
        },
      },
    );

    expect(project.directoryPath).toBe(projectDir);
    expect(createSessionInput.cli).toBe("claude");
    expect(createSessionInput.workingDirectory).toBe(path.join(projectDir, "workspace"));
    expect(createSessionInput.launch).toEqual({
      command: "claude",
      args: ["--role", "architect", "--persona=architect"],
      env: { KLEIBER_AGENT_ROLE: "architect" },
    });
    expect(createSessionInput.mcpEnabled).toBe(true);
    expect(createSessionInput.mcpLaunchConfig).toEqual({
      injectionMethod: "argv",
      wrapperCommand: process.execPath,
      wrapperArgs: ["/tmp/wrapper.js"],
      argsTemplate: ["--mcp", "{wrapperCommand}", "{wrapperArgsJson}"],
      envTemplate: {
        MCP_SESSION: "{sessionId}",
        MCP_PROJECT: "{projectId}",
      },
    });
  });

  it("can disable MCP injection explicitly for supported agent CLIs", async () => {
    const { resolveSessionCreateOptions } = await import("./handlers.js");

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-agent-no-mcp-"));
    mockState.projects.set("project-6", {
      id: "project-6",
      name: "Project 6",
      directoryPath: projectDir,
      yoloDefault: true,
      createdAt: new Date().toISOString(),
    });

    mockState.readProjectConfigMock.mockResolvedValue(
      buildPackConfig({
        harness_adapters: {
          codex: {
            enabled: true,
            orchestration: "native_subagents",
            launch_command: "codex",
            mcp_injection: "env",
            yolo_flag: "--dangerously-bypass-approvals-and-sandbox",
          },
        },
      }),
    );

    const { createSessionInput } = await resolveSessionCreateOptions(
      {
        projectId: "project-6",
        name: "Codex",
        type: "agent",
        cli: "codex",
        yolo: true,
        mcpEnabled: false,
      },
      {
        storeInstance: { getProject: mockState.getProjectMock },
        packManager: { readProjectConfig: mockState.readProjectConfigMock },
        mcpRuntime: {
          wrapperCommand: process.execPath,
          wrapperArgs: ["/tmp/wrapper.js"],
        },
      },
    );

    expect(createSessionInput.defaultYolo).toBe(false);
    expect(createSessionInput.launch).toEqual({
      command: "codex",
      args: ["--dangerously-bypass-approvals-and-sandbox"],
      env: {},
    });
    expect(createSessionInput.mcpEnabled).toBe(false);
    expect(createSessionInput.mcpLaunchConfig).toBeNull();
  });

  it("rejects agent sessions that do not resolve to a supported CLI", async () => {
    const { resolveSessionCreateOptions } = await import("./handlers.js");

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "kleiber-agent-invalid-"));
    mockState.projects.set("project-7", {
      id: "project-7",
      name: "Project 7",
      directoryPath: projectDir,
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    });

    await expect(
      resolveSessionCreateOptions(
        {
          projectId: "project-7",
          name: "Invalid",
          type: "agent",
          cli: "unknown-cli",
        },
        {
          storeInstance: { getProject: mockState.getProjectMock },
          packManager: { readProjectConfig: mockState.readProjectConfigMock },
        },
      ),
    ).rejects.toThrow(/supported CLI identifier/);
  });

  it("notifies on session exit when the app is unfocused", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const sessionExitHandler = mockState.onSessionEventMock.mock.calls.find(
      (call) => call[0] === "session-exited",
    )?.[1] as ((payload: any) => void) | undefined;

    sessionExitHandler?.({
      session: {
        id: "session-exit-1",
        name: "Exit Session",
        exitCode: 7,
        signal: null,
      },
      previousState: "running",
    });

    expect(mockState.notifySessionExitIfUnfocusedMock).toHaveBeenCalledWith(
      {
        session: {
          id: "session-exit-1",
          name: "Exit Session",
          exitCode: 7,
          signal: null,
        },
        previousState: "running",
      },
      [],
    );
  });

  it("hashes and stores remote API credentials from IPC", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.remoteApiCredentials.update);
    const summary = await handler?.({}, {
      username: "alice",
      password: "super-secret",
    });

    const savedCredentials = mockState.setRemoteApiCredentialsMock.mock.calls.at(-1)?.[0] as {
      username: string;
      passwordHash: string;
    };

    expect(savedCredentials.username).toBe("alice");
    expect(savedCredentials.passwordHash).not.toBe("super-secret");
    expect(savedCredentials.passwordHash.length).toBeGreaterThan(20);
    expect(summary).toEqual({
      username: "alice",
      hasPassword: true,
    });
  });

  it("preserves the existing password hash when only the username changes", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    mockState.getRemoteApiCredentialsMock.mockReturnValue({
      username: "alice",
      passwordHash: "stored-hash",
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.remoteApiCredentials.update);
    await handler?.({}, {
      username: "alice-next",
      password: "",
    });

    expect(mockState.setRemoteApiCredentialsMock).toHaveBeenCalledWith({
      username: "alice-next",
      passwordHash: "stored-hash",
    });
  });

  it("deletes exited sessions through IPC", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.delete);
    await handler?.({}, "session-1");

    expect(mockState.deleteSessionMock).toHaveBeenCalledWith("session-1");
  });

  it("suppresses expected logging when input is sent to an exited session", async () => {
    const { registerIpcHandlers } = await import("./handlers.js");
    registerIpcHandlers();

    mockState.sendSessionMock.mockImplementation(() => {
      throw new Error("Session session-1 is not running.");
    });

    const handler = mockState.registeredHandlers.get(IPC_CHANNELS.sessions.send);
    await expect(handler?.({}, "session-1", "ls\n")).resolves.toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });
});
