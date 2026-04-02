import { EventEmitter } from "node:events";

import bcrypt from "bcryptjs";
import type { Project, RemoteApiCredentials } from "@kleiber/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { issueAuthToken } from "../auth";
import { buildRemoteApiApp } from "../server";
import { registerTerminalWebSocketRoutes } from "./terminal";

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

class FakeSessionManager extends EventEmitter {
  readonly #sessions = new Map<string, Record<string, unknown>>();
  readonly #bufferedOutput = new Map<string, string[]>();
  readonly sendToSession = vi.fn();
  readonly createSession = vi.fn();
  readonly listSessions = vi.fn((projectId: string) =>
    [...this.#sessions.values()].filter((session) => session.projectId === projectId),
  );

  constructor(input: {
    sessions?: Record<string, unknown>[];
    bufferedOutput?: Record<string, string[]>;
  } = {}) {
    super();

    for (const session of input.sessions ?? [buildSession()]) {
      this.#sessions.set(session.id as string, session);
    }

    for (const [sessionId, output] of Object.entries(input.bufferedOutput ?? {})) {
      this.#bufferedOutput.set(sessionId, output);
    }
  }

  getSession(sessionId: string): Record<string, unknown> | undefined {
    return this.#sessions.get(sessionId);
  }

  readSession(sessionId: string): string[] {
    return this.#bufferedOutput.get(sessionId) ?? [];
  }
}

class FakeRouteSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  readonly sentMessages: Record<string, unknown>[] = [];
  readonly closeEvents: Array<{ code: number; reason: string }> = [];

  send(payload: string): void {
    this.sentMessages.push(JSON.parse(payload) as Record<string, unknown>);
  }

  close(code: number, reason: string): void {
    this.readyState = WebSocket.CLOSED;
    this.closeEvents.push({ code, reason });
    this.emit("close", code, Buffer.from(reason, "utf8"));
  }

  terminate(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1006, Buffer.alloc(0));
  }
}

async function captureInputRoute(options: {
  sessionManager: FakeSessionManager;
  signingKey: Buffer;
  authTimeoutMs?: number;
  maxConnectionsPerUser?: number;
  maxPayloadBytes?: number;
}): Promise<(socket: FakeRouteSocket, request: { params: { sessionId: string } }) => void> {
  let inputRouteHandler:
    | ((socket: FakeRouteSocket, request: { params: { sessionId: string } }) => void)
    | null = null;

  const app = {
    get: (
      path: string,
      _routeOptions: unknown,
      handler: (socket: FakeRouteSocket, request: { params: { sessionId: string } }) => void,
    ) => {
      if (path === "/ws/sessions/:sessionId/input") {
        inputRouteHandler = handler;
      }
    },
  };

  await registerTerminalWebSocketRoutes(app as any, options);

  if (!inputRouteHandler) {
    throw new Error("Failed to capture terminal input websocket route.");
  }

  return inputRouteHandler;
}

function buildDependencies(overrides: {
  credentials?: RemoteApiCredentials | null;
  sessions?: Record<string, unknown>[];
  bufferedOutput?: Record<string, string[]>;
} = {}) {
  const project = buildProject();
  const sessionManager = new FakeSessionManager({
    sessions: overrides.sessions,
    bufferedOutput: overrides.bufferedOutput,
  });

  const store = {
    listProjects: vi.fn(() => [project]),
    getProject: vi.fn((projectId: string) => (projectId === project.id ? project : undefined)),
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    getRemoteApiCredentials: vi.fn(() => overrides.credentials ?? null),
  };

  const packManager = {
    readProjectConfig: vi.fn(async () => null),
  };

  const createSessionResolver = vi.fn();

  return { project, sessionManager, store, packManager, createSessionResolver };
}

async function startApp(overrides: {
  credentials?: RemoteApiCredentials | null;
  sessions?: Record<string, unknown>[];
  bufferedOutput?: Record<string, string[]>;
  now?: () => number;
  websocket?: {
    authTimeoutMs?: number;
    maxConnectionsPerUser?: number;
    maxPayloadBytes?: number;
  };
} = {}) {
  const dependencies = buildDependencies(overrides);
  const signingKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
  const app = await buildRemoteApiApp({
    store: dependencies.store,
    packManager: dependencies.packManager,
    sessionManager: dependencies.sessionManager as any,
    createSessionResolver: dependencies.createSessionResolver,
    signingKey,
    now: overrides.now,
    websocket: overrides.websocket,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    ...dependencies,
    signingKey,
    app,
    wsBaseUrl: address.replace(/^http/u, "ws"),
  };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (payload) => {
      try {
        resolve(JSON.parse(payload.toString("utf8")) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function waitForMessages(socket: WebSocket, count: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const onMessage = (payload: WebSocket.RawData) => {
      try {
        messages.push(JSON.parse(payload.toString("utf8")) as Record<string, unknown>);
        if (messages.length >= count) {
          socket.off("message", onMessage);
          socket.off("error", onError);
          resolve(messages);
        }
      } catch (error) {
        socket.off("message", onMessage);
        socket.off("error", onError);
        reject(error);
      }
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(error);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
    socket.once("error", reject);
  });
}

const openApps = new Set<{ close: () => Promise<unknown> }>();
const openSockets = new Set<WebSocket>();

afterEach(async () => {
  await Promise.all(
    [...openSockets].map(async (socket) => {
      openSockets.delete(socket);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        await new Promise<void>((resolve) => {
          const fallback = setTimeout(() => {
            if (socket.readyState !== WebSocket.CLOSED) {
              socket.terminate();
            }
          }, 200);
          socket.once("close", () => {
            clearTimeout(fallback);
            resolve();
          });
          socket.close();
        });
      }
    }),
  );

  await Promise.all(
    [...openApps].map(async (app) => {
      openApps.delete(app);
      await app.close();
    }),
  );
});

describe("terminal websocket routes", () => {
  it("authenticates on the first message and streams buffered plus live output", async () => {
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 4),
    };
    const runtime = await startApp({
      credentials,
      bufferedOutput: {
        "session-1": ["line one", "line two"],
      },
    });
    openApps.add(runtime.app);

    const token = issueAuthToken("kleiber", runtime.signingKey).token;
    const socket = new WebSocket(`${runtime.wsBaseUrl}/ws/sessions/session-1/output`);
    openSockets.add(socket);
    await waitForOpen(socket);

    const initialMessages = waitForMessages(socket, 2);
    socket.send(JSON.stringify({ token }));

    const [first, second] = await initialMessages;
    expect([first.type, second.type].sort()).toEqual(["ready", "snapshot"]);
    expect([first, second]).toContainEqual({
      type: "snapshot",
      sessionId: "session-1",
      output: "line one\nline two",
    });

    const outputMessage = waitForMessage(socket);
    runtime.sessionManager.emit("session-output", {
      sessionId: "session-1",
      projectId: "project-1",
      chunk: "tail",
      appendedLines: ["tail"],
    });
    await expect(outputMessage).resolves.toEqual({
      type: "output",
      sessionId: "session-1",
      data: "tail",
    });

    const exitMessage = waitForMessage(socket);
    runtime.sessionManager.emit("session-exited", {
      session: {
        id: "session-1",
        exitCode: 0,
        signal: null,
      },
      previousState: "running",
    });
    await expect(exitMessage).resolves.toEqual({
      type: "exit",
      sessionId: "session-1",
      exitCode: 0,
      signal: null,
    });
  });

  it("authenticates input sockets and forwards terminal input", async () => {
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 4),
    };
    const runtime = await startApp({ credentials });
    openApps.add(runtime.app);

    const token = issueAuthToken("kleiber", runtime.signingKey).token;
    const socket = new WebSocket(`${runtime.wsBaseUrl}/ws/sessions/session-1/input`);
    openSockets.add(socket);
    await waitForOpen(socket);

    socket.send(JSON.stringify({ token }));
    await expect(waitForMessage(socket)).resolves.toEqual({
      type: "ready",
      username: "kleiber",
    });

    const acceptedMessage = waitForMessage(socket);
    socket.send(JSON.stringify({ input: "pwd\n" }));
    await expect(acceptedMessage).resolves.toEqual({
      type: "accepted",
      sessionId: "session-1",
      length: 4,
    });
    expect(runtime.sessionManager.sendToSession).toHaveBeenCalledWith("session-1", "pwd\n");
  });

  it("closes unauthenticated sockets after the configured timeout", async () => {
    const runtime = await startApp({
      websocket: {
        authTimeoutMs: 50,
      },
    });
    openApps.add(runtime.app);

    const socket = new WebSocket(`${runtime.wsBaseUrl}/ws/sessions/session-1/output`);
    openSockets.add(socket);
    await waitForOpen(socket);

    await expect(waitForClose(socket)).resolves.toEqual({
      code: 4401,
      reason: "Authentication timeout",
    });
  });

  it("rejects sockets whose first message carries an invalid token", async () => {
    const runtime = await startApp();
    openApps.add(runtime.app);

    const socket = new WebSocket(`${runtime.wsBaseUrl}/ws/sessions/session-1/output`);
    openSockets.add(socket);
    await waitForOpen(socket);

    const closed = waitForClose(socket);
    socket.send(JSON.stringify({ token: "not-a-valid-token" }));

    await expect(closed).resolves.toEqual({
      code: 4401,
      reason: "Invalid token",
    });
  });

  it("rejects sockets whose first message carries an expired token", async () => {
    const issuedAt = Date.parse("2026-04-02T10:00:00.000Z");
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 4),
    };
    const runtime = await startApp({
      credentials,
      now: () => issuedAt + (24 * 60 * 60 * 1000) + 1_000,
    });
    openApps.add(runtime.app);

    const expiredToken = issueAuthToken(
      "kleiber",
      runtime.signingKey,
      () => issuedAt,
    ).token;
    const socket = new WebSocket(`${runtime.wsBaseUrl}/ws/sessions/session-1/input`);
    openSockets.add(socket);
    await waitForOpen(socket);

    const closed = waitForClose(socket);
    socket.send(JSON.stringify({ token: expiredToken }));

    await expect(closed).resolves.toEqual({
      code: 4401,
      reason: "Invalid token",
    });
  });

  it("rejects connections above the per-user limit", async () => {
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 4),
    };
    const runtime = await startApp({
      credentials,
      websocket: {
        maxConnectionsPerUser: 1,
      },
    });
    openApps.add(runtime.app);

    const token = issueAuthToken("kleiber", runtime.signingKey).token;
    const firstSocket = new WebSocket(`${runtime.wsBaseUrl}/ws/sessions/session-1/input`);
    openSockets.add(firstSocket);
    await waitForOpen(firstSocket);
    firstSocket.send(JSON.stringify({ token }));
    await waitForMessage(firstSocket);

    const secondSocket = new WebSocket(`${runtime.wsBaseUrl}/ws/sessions/session-1/input`);
    openSockets.add(secondSocket);
    await waitForOpen(secondSocket);
    const closedSecondSocket = waitForClose(secondSocket);
    secondSocket.send(JSON.stringify({ token }));

    await expect(closedSecondSocket).resolves.toEqual({
      code: 4409,
      reason: "Connection limit exceeded",
    });
  });

  it("closes input sockets when a post-auth payload exceeds the size limit", async () => {
    const signingKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const sessionManager = new FakeSessionManager();
    const inputRouteHandler = await captureInputRoute({
      sessionManager,
      signingKey,
      maxPayloadBytes: 256,
    });

    const socket = new FakeRouteSocket();
    const token = issueAuthToken("kleiber", signingKey).token;
    inputRouteHandler(socket, {
      params: {
        sessionId: "session-1",
      },
    });

    socket.emit("message", Buffer.from(JSON.stringify({ token }), "utf8"));
    expect(socket.sentMessages).toContainEqual({
      type: "ready",
      username: "kleiber",
    });

    socket.emit("message", Buffer.from(JSON.stringify({ input: "x".repeat(1024) }), "utf8"));
    expect(socket.closeEvents).toEqual([
      {
        code: 1009,
        reason: "Payload too large",
      },
    ]);
    expect(sessionManager.sendToSession).not.toHaveBeenCalled();
  });
});
