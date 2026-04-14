import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AgentPackConfig, Project } from "@kleiber/shared";

import { McpOrchestrator } from "./orchestrator";

function buildPackConfig(overrides: Partial<AgentPackConfig> = {}): AgentPackConfig {
  return {
    version: 1,
    providers: {
      allowed: ["openai"],
      disallowed: [],
    },
    models: {
      defaults: {
        low_complexity: { provider: "openai", model: "mini" },
        medium_complexity: { provider: "openai", model: "medium" },
        high_complexity: { provider: "openai", model: "large" },
      },
      notes: [],
    },
    harness_adapters: {
      codex: {
        enabled: true,
        launch_command: "codex",
        orchestration: "native_subagents",
        yolo_flag: "--dangerously-bypass-approvals-and-sandbox",
        mcp_injection: "argv",
      },
      claude_code: {
        enabled: true,
        launch_command: "claude",
        orchestration: "native_subagents_or_agent_teams",
        yolo_flag: "--dangerously-skip-permissions",
        mcp_injection: "argv",
      },
      opencode: {
        enabled: true,
        launch_command: "opencode",
        orchestration: "plugin_or_manual",
        mcp_injection: "env",
      },
      gemini_cli: {
        enabled: true,
        launch_command: "gemini",
        orchestration: "experimental_subagents",
        yolo_flag: "--yolo",
        mcp_injection: "env",
      },
    },
    mcp: {
      available: ["kleiber-local"],
      notes: [],
    },
    agent_overrides: {
      claude_code: {
        model_flag: "--model",
        mcp_args_template: ["--mcp-config", "{mcpConfigPath}"],
        mcp_config_file_name: "claude-mcp-config.json",
        mcp_config_content:
          '{"mcpServers":{"kleiber":{"command":{wrapperCommandJson},"args":{wrapperArgsJson},"env":{"KLEIBER_SESSION_ID":"{sessionId}","KLEIBER_PROJECT_ID":"{projectId}","KLEIBER_MCP_SOCKET_PATH":"{mcpSocketPath}","KLEIBER_MCP_DEBUG_LOG_PATH":"{mcpDebugLogPath}","ELECTRON_RUN_AS_NODE":"1"}}}}',
      },
      codex: {
        model_flag: "--model",
        mcp_args_template: [
          "-c",
          "mcp_servers.kleiber.command={wrapperCommandJson}",
          "-c",
          "mcp_servers.kleiber.args={wrapperArgsJson}",
        ],
      },
      opencode: {
        model_env_template: {
          OPENCODE_CONFIG_CONTENT:
            '{"agents":{"coder":{"model":{modelJson}},"summarizer":{"model":{modelJson}},"task":{"model":{modelJson}},"title":{"model":{modelJson}}}}',
        },
        mcp_env_template: {
          OPENCODE_CONFIG_CONTENT:
            '{"$schema":"https://opencode.ai/config.json","mcp":{"kleiber":{"type":"local","enabled":true,"command":{wrapperCommandAndArgsJson},"environment":{"KLEIBER_SESSION_ID":"{sessionId}","KLEIBER_PROJECT_ID":"{projectId}","KLEIBER_MCP_SOCKET_PATH":"{mcpSocketPath}","KLEIBER_MCP_DEBUG_LOG_PATH":"{mcpDebugLogPath}","ELECTRON_RUN_AS_NODE":"1"}}}}',
        },
      },
      gemini_cli: {
        model_flag: "--model",
        mcp_env_template: {
          GEMINI_CLI_SYSTEM_SETTINGS_PATH: "{mcpConfigPath}",
        },
        mcp_config_file_name: "gemini-settings.json",
        mcp_config_content:
          '{"mcpServers":{"kleiber":{"command":{wrapperCommandJson},"args":{wrapperArgsJson},"env":{"KLEIBER_SESSION_ID":"{sessionId}","KLEIBER_PROJECT_ID":"{projectId}","KLEIBER_MCP_SOCKET_PATH":"{mcpSocketPath}","KLEIBER_MCP_DEBUG_LOG_PATH":"{mcpDebugLogPath}","ELECTRON_RUN_AS_NODE":"1"}}}}',
      },
    },
    ...overrides,
  };
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Project 1",
    directoryPath: "/tmp/project-1",
    yoloDefault: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildSession(overrides: Partial<any> = {}) {
  return {
    id: "session-root",
    name: "root",
    projectId: "project-1",
    parentSessionId: null,
    type: "agent",
    cli: "claude",
    role: null,
    yolo: false,
    state: "running",
    exitCode: null,
    pid: 100,
    outputBuffer: [],
    mcpEnabled: true,
    mcpWrapperId: 200,
    workingDirectory: "/tmp/project-1",
    childSessionIds: [],
    signal: null,
    ...overrides,
  };
}

function createHarness(options: {
  project?: Project;
  sessions?: any[];
  listSessions?: ReturnType<typeof vi.fn>;
  getSession?: ReturnType<typeof vi.fn>;
  createSession?: ReturnType<typeof vi.fn>;
  readSession?: ReturnType<typeof vi.fn>;
  sendToSession?: ReturnType<typeof vi.fn>;
  killSession?: ReturnType<typeof vi.fn>;
  roles?: string[];
  projectConfig?: AgentPackConfig | null;
  now?: () => number;
  maxSessionsPerProject?: number;
  maxSessionDepth?: number;
  maxSpawnRequestsPerMinute?: number;
  mcpRuntime?: {
    wrapperCommand: string;
    wrapperArgs: string[];
  };
} = {}) {
  const project = options.project ?? buildProject();
  const sessions = options.sessions ?? [buildSession()];
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const sessionEvents = new EventEmitter();

  const sessionManager = {
    createSession:
      options.createSession ??
      vi.fn(async (input) =>
        buildSession({
          id: "child-1",
          name: input.name ?? "child-1",
          parentSessionId: input.parentSessionId ?? null,
          projectId: input.projectId,
          yolo: input.requestedYolo ?? input.defaultYolo ?? false,
          workingDirectory: input.workingDirectory,
        }),
      ),
    getSession: options.getSession ?? vi.fn((sessionId: string) => sessionMap.get(sessionId)),
    listSessions:
      options.listSessions ??
      vi.fn((projectId: string) =>
        sessions.filter((session) => session.projectId === projectId),
      ),
    readSession: options.readSession ?? vi.fn(() => []),
    sendToSession: options.sendToSession ?? vi.fn(),
    killSession: options.killSession ?? vi.fn(),
    on: sessionEvents.on.bind(sessionEvents),
  };

  const store = {
    getProject: vi.fn((projectId: string) => (projectId === project.id ? project : undefined)),
  };

  const packManager = {
    discoverBundledRoles: vi.fn(async () => options.roles ?? ["architect"]),
    readProjectConfig: vi.fn(async () => options.projectConfig ?? buildPackConfig()),
  };

  const orchestrator = new McpOrchestrator({
    sessionManager,
    store,
    packManager,
    defaultPackConfig: buildPackConfig(),
    mcpRuntime: options.mcpRuntime ?? {
      wrapperCommand: process.execPath,
      wrapperArgs: ["/tmp/stdio-wrapper.js"],
    },
    ...(options.now ? { now: options.now } : {}),
    ...(options.maxSessionsPerProject !== undefined
      ? { maxSessionsPerProject: options.maxSessionsPerProject }
      : {}),
    ...(options.maxSessionDepth !== undefined ? { maxSessionDepth: options.maxSessionDepth } : {}),
    ...(options.maxSpawnRequestsPerMinute !== undefined
      ? { maxSpawnRequestsPerMinute: options.maxSpawnRequestsPerMinute }
      : {}),
  });

  return { orchestrator, sessionManager, sessionEvents, store, packManager, project, sessions };
}

describe("McpOrchestrator", () => {
  it("exposes initialize metadata and the five supported tools", async () => {
    const { orchestrator } = createHarness();

    expect(orchestrator.initialize()).toMatchObject({
      protocolVersion: "2025-03-26",
      serverInfo: {
        name: "kleiber-mcp-orchestrator",
        version: "0.0.0",
      },
    });

    const tools = orchestrator.listTools() as { tools: Array<{ name: string }>; version: string };
    expect(tools.version).toBe("0.0.0");
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "spawn_session",
      "send_to_session",
      "read_session",
      "list_sessions",
      "kill_session",
      "list_available_roles",
      "notify_parent",
      "wait_for_child_notification",
    ]);

    await expect(
      orchestrator.handleParentRequest({
        method: "tools/list",
        params: {},
        context: { sessionId: "session-root", projectId: "project-1" },
      }),
    ).resolves.toMatchObject({
      version: "0.0.0",
      tools: expect.any(Array),
    });
  });

  it("spawns sub-sessions with enforced project scoping, yolo inheritance, and allowlisted roles", async () => {
    const project = buildProject({ yoloDefault: true });
    const rootSession = buildSession({ yolo: false });
    const createSession = vi.fn(async (input) =>
      buildSession({
        id: "child-1",
        name: input.name ?? "child-1",
        parentSessionId: input.parentSessionId,
        projectId: input.projectId,
        yolo: false,
      }),
    );
    const { orchestrator, sessionManager } = createHarness({
      project,
      sessions: [rootSession],
      createSession,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            cli: "claude",
            role: "architect",
            yolo: true,
            working_dir: "/tmp/project-1/subdir",
            name: "Child Session",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      session_id: "child-1",
      name: "Child Session",
      yolo: false,
    });

    expect(sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        parentSessionId: "session-root",
        requestedYolo: true,
        defaultYolo: false,
        workingDirectory: "/tmp/project-1/subdir",
        role: "architect",
        mcpEnabled: true,
        mcpLaunchConfig: expect.objectContaining({
          injectionMethod: "argv",
        }),
        launch: expect.objectContaining({
          args: [expect.stringMatching(/kleiber-bootstrap.*\.md$/)],
        }),
      }),
    );
  });

  it("bootstraps Codex role sessions and applies explicit model overrides when spawning", async () => {
    const createSession = vi.fn(async (input) =>
      buildSession({
        id: "child-codex",
        name: input.name ?? "child-codex",
        parentSessionId: input.parentSessionId,
        projectId: input.projectId,
        yolo: false,
      }),
    );
    const { orchestrator, sessionManager } = createHarness({
      createSession,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            cli: "codex",
            role: "architect",
            model: "gpt-5.4-mini",
            name: "Codex Architect",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      session_id: "child-codex",
      name: "Codex Architect",
      yolo: false,
    });

    expect(sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        launch: expect.objectContaining({
          args: ["--model", "gpt-5.4-mini"],
          env: { KLEIBER_AGENT_ROLE: "architect" },
          prompt: expect.stringContaining(".codex/agents/architect.toml"),
        }),
      }),
    );
  });

  it.each([
    { cli: "claude", expectedArgs: ["--model", "gpt-5.4-mini"] },
    { cli: "gemini", expectedArgs: ["--model", "gpt-5.4-mini"] },
    { cli: "opencode", expectedEnvKey: "OPENCODE_CONFIG_CONTENT" },
  ])("applies explicit model overrides when spawning %s sessions", async (testCase) => {
    const createSession = vi.fn(async (input) =>
      buildSession({
        id: `child-${testCase.cli}`,
        name: input.name ?? `child-${testCase.cli}`,
        parentSessionId: input.parentSessionId,
        projectId: input.projectId,
        yolo: false,
      }),
    );
    const { orchestrator, sessionManager } = createHarness({
      createSession,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            cli: testCase.cli,
            model: "gpt-5.4-mini",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      session_id: `child-${testCase.cli}`,
      name: `child-${testCase.cli}`,
      yolo: false,
    });

    const createInput = sessionManager.createSession.mock.calls.at(-1)?.[0] as Record<string, any>;
    if ("expectedArgs" in testCase) {
      expect(createInput.launch.args).toEqual(testCase.expectedArgs);
      return;
    }

    expect(JSON.parse(createInput.launch.env[testCase.expectedEnvKey])).toEqual({
      agents: {
        coder: { model: "gpt-5.4-mini" },
        summarizer: { model: "gpt-5.4-mini" },
        task: { model: "gpt-5.4-mini" },
        title: { model: "gpt-5.4-mini" },
      },
    });
  });

  it("enables MCP for spawned child sessions so they can create deeper hierarchies", async () => {
    const createSession = vi.fn(async (input) =>
      buildSession({
        id: "child-1",
        name: input.name ?? "child-1",
        parentSessionId: input.parentSessionId,
        projectId: input.projectId,
        yolo: false,
        mcpEnabled: input.mcpEnabled ?? false,
      }),
    );
    const { orchestrator, sessionManager } = createHarness({
      createSession,
      mcpRuntime: {
        wrapperCommand: process.execPath,
        wrapperArgs: ["/tmp/stdio-wrapper.js"],
      },
    });

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            cli: "claude",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      session_id: "child-1",
      name: "child-1",
      yolo: false,
    });

    expect(sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpEnabled: true,
        mcpLaunchConfig: expect.objectContaining({
          injectionMethod: "argv",
          wrapperCommand: process.execPath,
          wrapperArgs: ["/tmp/stdio-wrapper.js"],
        }),
      }),
    );
  });

  it("passes harness YOLO flags for spawned sessions when effective yolo is true", async () => {
    const rootSession = buildSession({ yolo: true });
    const cases = [
      {
        cli: "claude",
        harness_adapters: {
          claude_code: {
            enabled: true,
            launch_command: "claude",
            orchestration: "native_subagents_or_agent_teams",
          },
        },
        expectedFlag: "--dangerously-skip-permissions",
      },
      {
        cli: "codex",
        harness_adapters: {
          codex: {
            enabled: true,
            launch_command: "codex",
            orchestration: "native_subagents",
          },
        },
        expectedFlag: "--dangerously-bypass-approvals-and-sandbox",
      },
      {
        cli: "gemini",
        harness_adapters: {
          gemini_cli: {
            enabled: true,
            launch_command: "gemini",
            orchestration: "experimental_subagents",
          },
        },
        expectedFlag: "--yolo",
      },
    ] as const;

    for (const testCase of cases) {
      const createSession = vi.fn(async (input) =>
        buildSession({
          id: `child-${testCase.cli}`,
          name: input.name ?? `${testCase.cli}-child`,
          parentSessionId: input.parentSessionId,
          projectId: input.projectId,
          yolo: true,
        }),
      );
      const { orchestrator, sessionManager } = createHarness({
        sessions: [rootSession],
        createSession,
        projectConfig: buildPackConfig({
          harness_adapters: testCase.harness_adapters,
        }),
      });

      await expect(
        orchestrator.callTool(
          {
            name: "spawn_session",
            arguments: {
              cli: testCase.cli,
              yolo: true,
            },
          },
          { sessionId: "session-root", projectId: "project-1" },
        ),
      ).resolves.toEqual({
        session_id: `child-${testCase.cli}`,
        name: `${testCase.cli}-child`,
        yolo: true,
      });

      expect(sessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          launch: expect.objectContaining({
            args: [testCase.expectedFlag],
          }),
        }),
      );
    }
  });

  it("rejects spawn_session schema violations and unsafe working directories", async () => {
    const { orchestrator } = createHarness();

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
            unexpected: true,
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/\$\.unexpected is not allowed/);

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
            working_dir: "relative/path",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/working_dir must be an absolute path/);

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
            working_dir: "/tmp/escape",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/working_dir must stay within the project directory/);
  });

  it("rejects cross-project spawns, disabled CLIs, and unknown roles", async () => {
    const { orchestrator: crossProject } = createHarness();
    await expect(
      crossProject.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-2",
            cli: "claude",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/Omit project_id to use the current project automatically/);

    const { orchestrator: disabledCli } = createHarness({
      projectConfig: buildPackConfig({
        harness_adapters: {
          claude_code: {
            enabled: false,
            launch_command: "claude",
            orchestration: "native_subagents_or_agent_teams",
          },
        },
      }),
    });
    await expect(
      disabledCli.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/disabled in agent_pack_config/);

    const { orchestrator: unknownRole } = createHarness({ roles: ["task-planner"] });
    await expect(
      unknownRole.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
            role: "architect",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/Unknown kleiber-agents role/);
  });

  it("enforces active-session limits without counting exited sessions", async () => {
    const activeSessions = Array.from({ length: 3 }, (_, index) =>
      buildSession({ id: `running-${index}`, state: "running" }),
    );
    const exitedSession = buildSession({ id: "exited-1", state: "exited" });
    const { orchestrator: allowed, sessionManager } = createHarness({
      sessions: [buildSession(), ...activeSessions, exitedSession],
      maxSessionsPerProject: 5,
    });

    await expect(
      allowed.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toMatchObject({ session_id: "child-1" });
    expect(sessionManager.createSession).toHaveBeenCalledTimes(1);

    const fullSessions = Array.from({ length: 5 }, (_, index) =>
      buildSession({ id: `active-${index}`, state: "running" }),
    );
    const { orchestrator: blocked } = createHarness({
      sessions: [buildSession(), ...fullSessions],
      maxSessionsPerProject: 5,
    });

    await expect(
      blocked.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/active session limit/);
  });

  it("enforces sub-session depth limits before spawning", async () => {
    const chain = [
      buildSession({ id: "session-root", parentSessionId: "p9" }),
      buildSession({ id: "p9", parentSessionId: "p8" }),
      buildSession({ id: "p8", parentSessionId: "p7" }),
      buildSession({ id: "p7", parentSessionId: "p6" }),
      buildSession({ id: "p6", parentSessionId: "p5" }),
      buildSession({ id: "p5", parentSessionId: "p4" }),
      buildSession({ id: "p4", parentSessionId: "p3" }),
      buildSession({ id: "p3", parentSessionId: "p2" }),
      buildSession({ id: "p2", parentSessionId: "p1" }),
      buildSession({ id: "p1", parentSessionId: null }),
    ];

    const { orchestrator } = createHarness({
      sessions: chain,
      maxSessionDepth: 10,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/depth limit/);
  });

  it("enforces per-session spawn rate limits over a rolling minute", async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(5_000)
      .mockReturnValueOnce(6_000);
    const { orchestrator, sessionManager } = createHarness({
      now,
      maxSpawnRequestsPerMinute: 5,
    });

    for (let index = 0; index < 5; index += 1) {
      await expect(
        orchestrator.callTool(
          {
            name: "spawn_session",
            arguments: {
              project_id: "project-1",
              cli: "claude",
            },
          },
          { sessionId: "session-root", projectId: "project-1" },
        ),
      ).resolves.toMatchObject({ session_id: "child-1" });
    }

    await expect(
      orchestrator.callTool(
        {
          name: "spawn_session",
          arguments: {
            project_id: "project-1",
            cli: "claude",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/rate limit/);

    expect(sessionManager.createSession).toHaveBeenCalledTimes(5);
  });

  it("sends input only to running sessions and blocks cross-project access", async () => {
    const running = buildSession({ id: "session-running", state: "running" });
    const exited = buildSession({ id: "session-exited", state: "exited" });
    const foreign = buildSession({ id: "session-foreign", projectId: "project-2" });
    const sendToSession = vi.fn();
    const { orchestrator } = createHarness({
      sessions: [buildSession(), running, exited, foreign],
      sendToSession,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "session-running",
            text: "pwd\n",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({ success: true });
    expect(sendToSession).toHaveBeenCalledWith("session-running", "pwd\r", { source: "mcp" });

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "session-exited",
            text: "pwd\n",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/is not running/);

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "session-foreign",
            text: "pwd\n",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/Cross-project/);
  });

  it("auto-submits send_to_session input with Enter unless submit=false is passed", async () => {
    const running = buildSession({ id: "session-running", state: "running" });
    const sendToSession = vi.fn();
    const { orchestrator } = createHarness({
      sessions: [buildSession(), running],
      sendToSession,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "session-running",
            text: "Summarize the repo state",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({ success: true });

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "session-running",
            text: "partial input",
            submit: false,
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({ success: true });

    expect(sendToSession).toHaveBeenNthCalledWith(1, "session-running", "Summarize the repo state\r", { source: "mcp" });
    expect(sendToSession).toHaveBeenNthCalledWith(2, "session-running", "partial input", { source: "mcp" });
  });

  it("normalizes trailing newlines to Enter when submit=true", async () => {
    const running = buildSession({ id: "session-running", state: "running" });
    const sendToSession = vi.fn();
    const { orchestrator } = createHarness({
      sessions: [buildSession(), running],
      sendToSession,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "session-running",
            text: "line with newline\n",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({ success: true });

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "session-running",
            text: "line with crlf\r\n",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({ success: true });

    expect(sendToSession).toHaveBeenNthCalledWith(1, "session-running", "line with newline\r", { source: "mcp" });
    expect(sendToSession).toHaveBeenNthCalledWith(2, "session-running", "line with crlf\r", { source: "mcp" });
  });

  it("returns plain and raw read_session payloads and validates input schemas", async () => {
    const readSession = vi.fn((_sessionId: string, options: { plainText: boolean; limit: number }) =>
      options.plainText ? ["plain", "output"] : ["\u001b[31mraw\u001b[0m"],
    );
    const { orchestrator } = createHarness({ readSession });

    await expect(
      orchestrator.callTool(
        {
          name: "read_session",
          arguments: {
            session_id: "session-root",
            lines: 2,
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      output: "plain\noutput",
      line_count: 2,
      format: "plain",
    });

    await expect(
      orchestrator.callTool(
        {
          name: "read_session",
          arguments: {
            session_id: "session-root",
            lines: 20,
            format: "raw",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      output: "\u001b[31mraw\u001b[0m",
      line_count: 1,
      format: "raw",
    });

    await expect(
      orchestrator.callTool(
        {
          name: "read_session",
          arguments: {
            session_id: "session-root",
            lines: 0,
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/\$\.lines must be >= 1/);
  });

  it("lists only caller-project sessions even when a different project_id is requested", async () => {
    const listSessions = vi.fn((projectId: string) => [
      buildSession({ id: `${projectId}-one`, projectId }),
      buildSession({ id: `${projectId}-two`, projectId, parentSessionId: `${projectId}-one` }),
    ]);
    const { orchestrator } = createHarness({ listSessions });

    await expect(
      orchestrator.callTool(
        {
          name: "list_sessions",
          arguments: {
            project_id: "project-2",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      project_id: "project-1",
      sessions: [
        {
          session_id: "project-1-one",
          name: "root",
          cli: "claude",
          role: null,
          state: "running",
          yolo: false,
          parent_session_id: null,
        },
        {
          session_id: "project-1-two",
          name: "root",
          cli: "claude",
          role: null,
          state: "running",
          yolo: false,
          parent_session_id: "project-1-one",
        },
      ],
    });
    expect(listSessions).toHaveBeenCalledWith("project-1");
  });

  it("lists available roles for role validation before spawning", async () => {
    const { orchestrator } = createHarness({ roles: ["architect", "task-planner"] });

    await expect(
      orchestrator.callTool(
        {
          name: "list_available_roles",
          arguments: {},
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      roles: ["architect", "task-planner"],
    });
  });

  it("lets subsessions notify their parent and lets parents wait without polling", async () => {
    const child = buildSession({
      id: "session-child",
      name: "claude:architect",
      parentSessionId: "session-root",
    });
    const { orchestrator } = createHarness({
      sessions: [buildSession(), child],
    });

    await expect(
      orchestrator.callTool(
        {
          name: "notify_parent",
          arguments: {
            text: "Task complete. Tests passed.",
          },
        },
        { sessionId: "session-child", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      delivered: true,
      parent_session_id: "session-root",
    });

    await expect(
      orchestrator.callTool(
        {
          name: "wait_for_child_notification",
          arguments: {
            child_session_id: "session-child",
            timeout_ms: 0,
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      notification: {
        kind: "child_message",
        child_session_id: "session-child",
        child_session_name: "claude:architect",
        delivered_at: expect.any(String),
        message: "Task complete. Tests passed.",
      },
      timed_out: false,
    });
  });

  it("queues child exit notifications so parents can wait on execution status changes", async () => {
    const child = buildSession({
      id: "session-child",
      name: "claude:architect",
      parentSessionId: "session-root",
      exitCode: 0,
      signal: null,
    });
    const { orchestrator, sessionEvents } = createHarness({
      sessions: [buildSession(), child],
    });

    sessionEvents.emit("session-exited", {
      session: {
        ...child,
        state: "exited",
        exitCode: 0,
        signal: null,
      },
      previousState: "running",
    });

    await expect(
      orchestrator.callTool(
        {
          name: "wait_for_child_notification",
          arguments: {
            child_session_id: "session-child",
            timeout_ms: 0,
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({
      notification: {
        kind: "child_exited",
        child_session_id: "session-child",
        child_session_name: "claude:architect",
        delivered_at: expect.any(String),
        exit_code: 0,
        signal: null,
      },
      timed_out: false,
    });
  });

  it("kills descendant sessions, but blocks self-kill and validates tool input", async () => {
    const killSession = vi.fn();
    const child = buildSession({ id: "session-child", parentSessionId: "session-root" });
    const { orchestrator } = createHarness({
      sessions: [buildSession(), child],
      killSession,
    });

    await expect(
      orchestrator.callTool(
        {
          name: "kill_session",
          arguments: {
            session_id: "session-child",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).resolves.toEqual({ success: true });
    expect(killSession).toHaveBeenCalledWith("session-child");

    await expect(
      orchestrator.callTool(
        {
          name: "kill_session",
          arguments: {
            session_id: "session-root",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/cannot kill itself/);

    await expect(
      orchestrator.callTool(
        {
          name: "kill_session",
          arguments: {},
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/\$\.session_id is required/);
  });
});
