import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type AgentPackConfig, type Project } from "@kleiber/shared";

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
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      mockState.registeredHandlers.set(channel, handler);
    },
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
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
    expect(createInput.defaultYolo).toBe(true);
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
});
