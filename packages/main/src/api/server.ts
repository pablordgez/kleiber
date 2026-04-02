import { createServer } from "node:net";
import path from "node:path";

import type { AppSettings } from "@kleiber/shared";
import { DEFAULT_REMOTE_API_BIND_ADDRESS, DEFAULT_REMOTE_API_START_PORT } from "@kleiber/shared";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";

import { createSigningKey, issueAuthToken, verifyPassword } from "./auth";
import { createAuthPreHandler } from "./middleware";
import { registerProjectRoutes } from "./routes/projects";
import { registerSessionRoutes } from "./routes/sessions";
import { type RemoteApiCreateSessionResolver, type RemoteApiPackManager, type RemoteApiSessionManager, type RemoteApiStore } from "./types";
import { registerTerminalWebSocketRoutes, DEFAULT_MAX_WS_PAYLOAD_BYTES } from "./ws/terminal";

export interface RemoteApiServerState {
  host: string;
  port: number;
}

export interface BuildRemoteApiAppOptions {
  store: Pick<RemoteApiStore, "getRemoteApiCredentials" | "listProjects" | "getProject">;
  packManager: Pick<RemoteApiPackManager, "discoverBundledRoles" | "readProjectConfig">;
  sessionManager: RemoteApiSessionManager;
  createSessionResolver: RemoteApiCreateSessionResolver;
  mcpRuntime?: {
    wrapperCommand: string;
    wrapperArgs: string[];
  };
  signingKey: Buffer;
  now?: () => number;
  websocket?: {
    authTimeoutMs?: number;
    maxConnectionsPerUser?: number;
    maxPayloadBytes?: number;
  };
}

export async function findAvailablePort(startPort: number, host: string): Promise<number> {
  let port = startPort;

  while (port <= 65_535) {
    if (await canListenOnPort(port, host)) {
      return port;
    }
    port += 1;
  }

  throw new Error(`No available port found starting from ${String(startPort)}.`);
}

async function canListenOnPort(port: number, host: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

export async function buildRemoteApiApp(options: BuildRemoteApiAppOptions): Promise<FastifyInstance> {
  const maxWebSocketPayload =
    options.websocket?.maxPayloadBytes ?? DEFAULT_MAX_WS_PAYLOAD_BYTES;
  const app = Fastify({
    bodyLimit: 1_000_000,
    logger: false,
  });

  app.decorateRequest("remoteApiAuth", null);

  await app.register(rateLimit, {
    global: false,
  });
  await app.register(websocket, {
    options: {
      maxPayload: maxWebSocketPayload,
    },
  });

  // Serve static files from the Vite-built web UI bundle
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "../web"),
    wildcard: false,
  });

  app.post(
    "/auth",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 60_000,
        },
      },
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          additionalProperties: false,
          properties: {
            username: { type: "string", minLength: 1 },
            password: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { username: string; password: string };
      const authenticated = await verifyPassword(
        options.store.getRemoteApiCredentials(),
        body.username,
        body.password,
      );

      if (!authenticated) {
        request.log.warn({ ip: request.ip, username: body.username }, "remote-api auth failed");
        return reply.code(401).send({ error: "Invalid credentials." });
      }

      return issueAuthToken(body.username, options.signingKey, options.now);
    },
  );

  const authPreHandlerOptions: Parameters<typeof createAuthPreHandler>[0] = {
    getCredentials: () => options.store.getRemoteApiCredentials(),
    signingKey: options.signingKey,
    publicPaths: ["/auth", "/ws/sessions/:sessionId/output", "/ws/sessions/:sessionId/input", "/*"],
  };
  if (options.now) {
    authPreHandlerOptions.now = options.now;
  }

  // Use a custom preHandler that skips auth for static files, but not for API routes
  const basePreHandler = createAuthPreHandler(authPreHandlerOptions);
  app.addHook("preHandler", async (request, reply) => {
    // Skip auth for static assets requests (simple heuristic: GET requests with an extension, or the root path)
    if (request.method === "GET" && (!request.url.startsWith("/projects") && !request.url.startsWith("/sessions") && !request.url.startsWith("/status"))) {
      return;
    }
    return (basePreHandler as any)(request, reply);
  });

  await registerProjectRoutes(app, {
    store: options.store,
  });
  await registerSessionRoutes(app, {
    store: options.store,
    packManager: options.packManager,
    sessionManager: options.sessionManager,
    createSessionResolver: options.createSessionResolver,
    ...(options.mcpRuntime ? { mcpRuntime: options.mcpRuntime } : {}),
  });
  const websocketRouteOptions = {
    sessionManager: options.sessionManager,
    signingKey: options.signingKey,
    ...(options.now ? { now: options.now } : {}),
    ...(options.websocket?.authTimeoutMs !== undefined
      ? { authTimeoutMs: options.websocket.authTimeoutMs }
      : {}),
    ...(options.websocket?.maxConnectionsPerUser !== undefined
      ? { maxConnectionsPerUser: options.websocket.maxConnectionsPerUser }
      : {}),
    ...(options.websocket?.maxPayloadBytes !== undefined
      ? { maxPayloadBytes: options.websocket.maxPayloadBytes }
      : {}),
  };
  await registerTerminalWebSocketRoutes(app, websocketRouteOptions);

  app.get("/status", async (request) => {
    return {
      ok: true,
      username: request.remoteApiAuth?.username ?? null,
      authMode: request.remoteApiAuth?.mode ?? null,
    };
  });

  // SPA fallback for all non-API routes
  app.setNotFoundHandler((request, reply) => {
    const accept = request.headers.accept;
    if (accept && accept.includes("application/json")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });

  return app;
}

export class RemoteApiServerController {
  readonly #store: RemoteApiStore;
  readonly #packManager: Pick<RemoteApiPackManager, "discoverBundledRoles" | "readProjectConfig">;
  readonly #sessionManager: RemoteApiSessionManager;
  readonly #createSessionResolver: RemoteApiCreateSessionResolver;
  readonly #mcpRuntime: {
    wrapperCommand: string;
    wrapperArgs: string[];
  } | null;
  readonly #now: () => number;
  readonly #signingKey: Buffer;
  #app: FastifyInstance | null = null;
  #state: RemoteApiServerState | null = null;

  constructor(options: {
    store: RemoteApiStore;
    packManager: Pick<RemoteApiPackManager, "discoverBundledRoles" | "readProjectConfig">;
    sessionManager: RemoteApiSessionManager;
    createSessionResolver: RemoteApiCreateSessionResolver;
    mcpRuntime?: {
      wrapperCommand: string;
      wrapperArgs: string[];
    };
    now?: () => number;
  }) {
    this.#store = options.store;
    this.#packManager = options.packManager;
    this.#sessionManager = options.sessionManager;
    this.#createSessionResolver = options.createSessionResolver;
    this.#mcpRuntime = options.mcpRuntime ?? null;
    this.#now = options.now ?? (() => Date.now());
    this.#signingKey = createSigningKey();
  }

  getState(): RemoteApiServerState | null {
    return this.#state;
  }

  async syncWithSettings(): Promise<AppSettings> {
    return this.applySettings(this.#store.getSettings());
  }

  async applySettings(settings: AppSettings): Promise<AppSettings> {
    if (!settings.remoteApiEnabled) {
      await this.stop();
      return settings;
    }

    const host = settings.remoteApiBindAddress || DEFAULT_REMOTE_API_BIND_ADDRESS;
    const requestedPort = settings.remoteApiPort ?? DEFAULT_REMOTE_API_START_PORT;
    const currentState = this.#state;

    if (currentState && currentState.host === host && currentState.port === requestedPort) {
      return settings;
    }

    await this.stop();

    const selectedPort = await findAvailablePort(requestedPort, host);
    const app = await buildRemoteApiApp({
      store: this.#store,
      packManager: this.#packManager,
      sessionManager: this.#sessionManager,
      createSessionResolver: this.#createSessionResolver,
      ...(this.#mcpRuntime ? { mcpRuntime: this.#mcpRuntime } : {}),
      signingKey: this.#signingKey,
      now: this.#now,
    });
    await app.listen({ host, port: selectedPort });

    this.#app = app;
    this.#state = { host, port: selectedPort };

    if (settings.remoteApiPort === selectedPort) {
      return settings;
    }

    return this.#store.setSettings({
      ...settings,
      remoteApiPort: selectedPort,
    });
  }

  async stop(): Promise<void> {
    if (!this.#app) {
      this.#state = null;
      return;
    }

    await this.#app.close();
    this.#app = null;
    this.#state = null;
  }
}
