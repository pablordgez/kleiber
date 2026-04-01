import { createServer } from "node:net";

import bcrypt from "bcryptjs";
import type { AppSettings, Project, RemoteApiCredentials } from "@kleiber/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRemoteApiApp, findAvailablePort, RemoteApiServerController } from "./server";

function buildSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    remoteApiEnabled: false,
    remoteApiPort: null,
    remoteApiBindAddress: "127.0.0.1",
    theme: "dark",
    quickLaunchShortcut: "CmdOrCtrl+K",
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

function buildSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    pid: 101,
    outputBuffer: [],
    mcpEnabled: false,
    mcpWrapperId: null,
    childSessionIds: [],
    signal: null,
    ...overrides,
  };
}

function buildDependencies(overrides: {
  credentials?: RemoteApiCredentials | null;
  projects?: Project[];
  sessions?: Record<string, unknown>[];
} = {}) {
  const projects = overrides.projects ?? [buildProject()];
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const sessions = overrides.sessions ?? [buildSession()];
  const credentials = overrides.credentials ?? null;

  const store = {
    listProjects: vi.fn(() => projects),
    getProject: vi.fn((projectId: string) => projectMap.get(projectId)),
    getSettings: vi.fn(() => buildSettings()),
    setSettings: vi.fn((settings: AppSettings) => settings),
    getRemoteApiCredentials: vi.fn(() => credentials),
  };

  const sessionManager = {
    createSession: vi.fn(async (input: Record<string, unknown>) =>
      buildSession({
        id: "session-created",
        projectId: input.projectId,
        parentSessionId: input.parentSessionId ?? null,
        name: input.name ?? "Created Session",
        type: input.type ?? "plain",
        cli: input.cli ?? null,
        role: input.role ?? null,
        yolo: input.requestedYolo ?? false,
      }),
    ),
    getSession: vi.fn((sessionId: string) =>
      sessions.find((session) => session.id === sessionId),
    ),
    listSessions: vi.fn((projectId: string) =>
      sessions.filter((session) => session.projectId === projectId),
    ),
    readSession: vi.fn(() => []),
    sendToSession: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  const packManager = {
    readProjectConfig: vi.fn(async () => null),
  };

  const createSessionResolver = vi.fn(
    async (
      payload: {
        projectId: string;
        parentSessionId?: string | null;
        name: string;
        type?: string;
        cli?: string;
        role?: string;
        yolo?: boolean;
        workingDirectory?: string;
        mcpEnabled?: boolean;
      },
      _options: unknown,
    ) => {
      const project = projectMap.get(payload.projectId);
      if (!project) {
        throw new Error(`Project ${payload.projectId} not found.`);
      }

      return {
        project,
        createSessionInput: {
          projectId: payload.projectId,
          parentSessionId: payload.parentSessionId ?? null,
          type: payload.type === "agent" || payload.type === "agent_role" ? payload.type : "plain",
          cli: payload.cli ?? null,
          role: payload.role ?? null,
          requestedYolo: payload.yolo,
          defaultYolo: project.yoloDefault,
          name: payload.name,
          workingDirectory: payload.workingDirectory ?? project.directoryPath,
          mcpEnabled: payload.mcpEnabled ?? false,
        },
      };
    },
  );

  return {
    store,
    sessionManager,
    packManager,
    createSessionResolver,
    projects,
    sessions,
  };
}

const openApps = new Set<{ close: () => Promise<unknown> }>();

afterEach(async () => {
  await Promise.all(
    [...openApps].map(async (app) => {
      openApps.delete(app);
      await app.close();
    }),
  );
});

describe("remote API server", () => {
  it("requires auth, issues bearer tokens, accepts basic auth, and serves REST routes", async () => {
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 12),
    };
    const dependencies = buildDependencies({ credentials });

    const app = await buildRemoteApiApp({
      store: dependencies.store,
      packManager: dependencies.packManager,
      sessionManager: dependencies.sessionManager as any,
      createSessionResolver: dependencies.createSessionResolver,
      signingKey: Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    });
    openApps.add(app);

    const unauthorized = await app.inject({
      method: "GET",
      url: "/status",
    });
    expect(unauthorized.statusCode).toBe(401);

    const authResponse = await app.inject({
      method: "POST",
      url: "/auth",
      payload: {
        username: "kleiber",
        password: "swordfish",
      },
    });
    expect(authResponse.statusCode).toBe(200);

    const authBody = authResponse.json() as { token: string; expiresAt: string };
    expect(authBody.token).toContain(".");
    expect(authBody.expiresAt).toMatch(/Z$/u);

    const bearerHeaders = {
      authorization: `Bearer ${authBody.token}`,
    };

    const bearerStatus = await app.inject({
      method: "GET",
      url: "/status",
      headers: bearerHeaders,
    });
    expect(bearerStatus.statusCode).toBe(200);
    expect(bearerStatus.json()).toEqual({
      ok: true,
      username: "kleiber",
      authMode: "bearer",
    });

    const basicProjects = await app.inject({
      method: "GET",
      url: "/projects",
      headers: {
        authorization: `Basic ${Buffer.from("kleiber:swordfish").toString("base64")}`,
      },
    });
    expect(basicProjects.statusCode).toBe(200);
    expect(basicProjects.json()).toEqual(dependencies.projects);

    const sessionsResponse = await app.inject({
      method: "GET",
      url: "/projects/project-1/sessions",
      headers: bearerHeaders,
    });
    expect(sessionsResponse.statusCode).toBe(200);
    expect(sessionsResponse.json()).toEqual(dependencies.sessions);

    const createResponse = await app.inject({
      method: "POST",
      url: "/projects/project-1/sessions",
      headers: bearerHeaders,
      payload: {
        name: "Created Session",
        type: "plain",
        workingDirectory: "/tmp/project-1",
      },
    });
    expect(createResponse.statusCode).toBe(201);
    expect(dependencies.createSessionResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        name: "Created Session",
      }),
      expect.anything(),
    );
    expect(dependencies.sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        name: "Created Session",
      }),
    );
  });

  it("rate limits repeated auth requests from the same IP", async () => {
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 12),
    };
    const dependencies = buildDependencies({ credentials });

    const app = await buildRemoteApiApp({
      store: dependencies.store,
      packManager: dependencies.packManager,
      sessionManager: dependencies.sessionManager as any,
      createSessionResolver: dependencies.createSessionResolver,
      signingKey: Buffer.from("abcdef0123456789abcdef0123456789", "utf8"),
    });
    openApps.add(app);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/auth",
        remoteAddress: "10.0.0.9",
        payload: {
          username: "kleiber",
          password: "wrong-password",
        },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/auth",
      remoteAddress: "10.0.0.9",
      payload: {
        username: "kleiber",
        password: "wrong-password",
      },
    });
    expect(limited.statusCode).toBe(429);
  });

  it("finds the next available port when the requested port is occupied", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));

    try {
      const occupiedPort = (blocker.address() as { port: number }).port;
      const selectedPort = await findAvailablePort(occupiedPort, "127.0.0.1");
      expect(selectedPort).toBeGreaterThan(occupiedPort);
    } finally {
      blocker.close();
    }
  });

  it("persists the selected port when the preferred port is unavailable", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));

    try {
      const occupiedPort = (blocker.address() as { port: number }).port;
      const credentials: RemoteApiCredentials = {
        username: "kleiber",
        passwordHash: await bcrypt.hash("swordfish", 12),
      };
      let persistedSettings = buildSettings({
        remoteApiEnabled: true,
        remoteApiBindAddress: "127.0.0.1",
        remoteApiPort: occupiedPort,
      });

      const dependencies = buildDependencies({ credentials });
      const controller = new RemoteApiServerController({
        store: {
          ...dependencies.store,
          getSettings: () => persistedSettings,
          setSettings: (settings) => {
            persistedSettings = settings;
            return settings;
          },
        },
        packManager: dependencies.packManager,
        sessionManager: dependencies.sessionManager as any,
        createSessionResolver: dependencies.createSessionResolver,
      });

      const updatedSettings = await controller.applySettings(persistedSettings);
      expect(updatedSettings.remoteApiPort).toBeGreaterThan(occupiedPort);
      expect(controller.getState()).toEqual({
        host: "127.0.0.1",
        port: updatedSettings.remoteApiPort,
      });

      await controller.stop();
    } finally {
      blocker.close();
    }
  });
});
