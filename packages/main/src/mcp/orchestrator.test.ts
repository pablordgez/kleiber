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
      claude_code: {
        enabled: true,
        launch_command: "claude",
        orchestration: "native_subagents_or_agent_teams",
      },
    },
    mcp: {
      available: ["kleiber-local"],
      notes: [],
    },
    agent_overrides: {},
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

describe("McpOrchestrator", () => {
  it("lists the five supported tools with version metadata", () => {
    const sessionManager = {
      createSession: vi.fn(),
      getSession: vi.fn(),
      listSessions: vi.fn(),
      readSession: vi.fn(),
      sendToSession: vi.fn(),
      killSession: vi.fn(),
    };
    const orchestrator = new McpOrchestrator({
      sessionManager,
      store: { getProject: vi.fn() },
      packManager: {
        discoverBundledRoles: vi.fn(async () => []),
        readProjectConfig: vi.fn(async () => null),
      },
      defaultPackConfig: buildPackConfig(),
    });

    const result = orchestrator.listTools() as any;
    expect(result.tools).toHaveLength(5);
    expect(result.version).toBe("0.0.0");
  });

  it("forces project scoping and yolo inheritance for spawn_session", async () => {
    const project: Project = {
      id: "project-1",
      name: "Project 1",
      directoryPath: "/tmp/project-1",
      yoloDefault: true,
      createdAt: new Date().toISOString(),
    };

    const createSession = vi.fn(async (input) => ({
      ...buildSession({
        id: "child-1",
        parentSessionId: "session-root",
        projectId: input.projectId,
        yolo: false,
        name: input.name ?? "child-1",
      }),
    }));

    const sessionManager = {
      createSession,
      getSession: vi.fn((sessionId: string) => (sessionId === "session-root" ? buildSession() : undefined)),
      listSessions: vi.fn(() => [buildSession()]),
      readSession: vi.fn(),
      sendToSession: vi.fn(),
      killSession: vi.fn(),
    };

    const orchestrator = new McpOrchestrator({
      sessionManager,
      store: { getProject: vi.fn(() => project) },
      packManager: {
        discoverBundledRoles: vi.fn(async () => ["architect"]),
        readProjectConfig: vi.fn(async () => buildPackConfig()),
      },
      defaultPackConfig: buildPackConfig(),
    });

    const result = await orchestrator.callTool(
      {
        name: "spawn_session",
        arguments: {
          project_id: "project-1",
          cli: "claude",
          role: "architect",
          yolo: true,
        },
      },
      { sessionId: "session-root", projectId: "project-1" },
    );

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: "session-root",
        requestedYolo: true,
        defaultYolo: true,
      }),
    );
    expect(result).toEqual({
      session_id: "child-1",
      name: "child-1",
      yolo: false,
    });
  });

  it("rejects cross-project session access", async () => {
    const foreignSession = buildSession({ id: "other", projectId: "project-2" });
    const sessionManager = {
      createSession: vi.fn(),
      getSession: vi.fn((sessionId: string) => (sessionId === "session-root" ? buildSession() : foreignSession)),
      listSessions: vi.fn(),
      readSession: vi.fn(),
      sendToSession: vi.fn(),
      killSession: vi.fn(),
    };
    const orchestrator = new McpOrchestrator({
      sessionManager,
      store: { getProject: vi.fn() },
      packManager: {
        discoverBundledRoles: vi.fn(async () => []),
        readProjectConfig: vi.fn(async () => null),
      },
      defaultPackConfig: buildPackConfig(),
    });

    await expect(
      orchestrator.callTool(
        {
          name: "send_to_session",
          arguments: {
            session_id: "other",
            text: "pwd\n",
          },
        },
        { sessionId: "session-root", projectId: "project-1" },
      ),
    ).rejects.toThrow(/Cross-project/);
  });

  it("enforces the project active session limit", async () => {
    const sessionManager = {
      createSession: vi.fn(),
      getSession: vi.fn(() => buildSession()),
      listSessions: vi.fn(() => Array.from({ length: 50 }, (_, index) => buildSession({ id: `s-${index}` }))),
      readSession: vi.fn(),
      sendToSession: vi.fn(),
      killSession: vi.fn(),
    };
    const orchestrator = new McpOrchestrator({
      sessionManager,
      store: {
        getProject: vi.fn(() => ({
          id: "project-1",
          name: "Project 1",
          directoryPath: "/tmp/project-1",
          yoloDefault: false,
          createdAt: new Date().toISOString(),
        })),
      },
      packManager: {
        discoverBundledRoles: vi.fn(async () => []),
        readProjectConfig: vi.fn(async () => buildPackConfig()),
      },
      defaultPackConfig: buildPackConfig(),
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
    ).rejects.toThrow(/50 active session limit/);
  });

  it("enforces spawn rate limits and depth limits", async () => {
    const depthTen = buildSession({ id: "session-root", parentSessionId: "p9" });
    const parents = new Map<string, any>([
      ["session-root", depthTen],
      ["p9", buildSession({ id: "p9", parentSessionId: "p8" })],
      ["p8", buildSession({ id: "p8", parentSessionId: "p7" })],
      ["p7", buildSession({ id: "p7", parentSessionId: "p6" })],
      ["p6", buildSession({ id: "p6", parentSessionId: "p5" })],
      ["p5", buildSession({ id: "p5", parentSessionId: "p4" })],
      ["p4", buildSession({ id: "p4", parentSessionId: "p3" })],
      ["p3", buildSession({ id: "p3", parentSessionId: "p2" })],
      ["p2", buildSession({ id: "p2", parentSessionId: "p1" })],
      ["p1", buildSession({ id: "p1", parentSessionId: null })],
    ]);

    const sessionManager = {
      createSession: vi.fn(),
      getSession: vi.fn((sessionId: string) => parents.get(sessionId)),
      listSessions: vi.fn(() => [buildSession()]),
      readSession: vi.fn(),
      sendToSession: vi.fn(),
      killSession: vi.fn(),
    };
    const orchestrator = new McpOrchestrator({
      sessionManager,
      store: {
        getProject: vi.fn(() => ({
          id: "project-1",
          name: "Project 1",
          directoryPath: "/tmp/project-1",
          yoloDefault: false,
          createdAt: new Date().toISOString(),
        })),
      },
      packManager: {
        discoverBundledRoles: vi.fn(async () => []),
        readProjectConfig: vi.fn(async () => buildPackConfig()),
      },
      defaultPackConfig: buildPackConfig(),
      now: vi
        .fn()
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(2_000)
        .mockReturnValueOnce(3_000)
        .mockReturnValueOnce(4_000)
        .mockReturnValueOnce(5_000)
        .mockReturnValueOnce(6_000),
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
      ).rejects.toThrow(/depth limit/);
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
  });

  it("returns plain and raw read_session payloads and blocks self-kill", async () => {
    const sessionManager = {
      createSession: vi.fn(),
      getSession: vi.fn((sessionId: string) => buildSession({ id: sessionId })),
      listSessions: vi.fn(() => [buildSession()]),
      readSession: vi.fn((_sessionId: string, options: { plainText: boolean; limit: number }) =>
        options.plainText ? ["plain"] : ["\u001b[31mraw\u001b[0m"],
      ),
      sendToSession: vi.fn(),
      killSession: vi.fn(),
    };
    const orchestrator = new McpOrchestrator({
      sessionManager,
      store: { getProject: vi.fn() },
      packManager: {
        discoverBundledRoles: vi.fn(async () => []),
        readProjectConfig: vi.fn(async () => null),
      },
      defaultPackConfig: buildPackConfig(),
    });

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
  });
});
