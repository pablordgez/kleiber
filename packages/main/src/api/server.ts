import { createServer } from "node:net";

import type { AppSettings, RemoteApiCredentials } from "@kleiber/shared";
import { DEFAULT_REMOTE_API_BIND_ADDRESS, DEFAULT_REMOTE_API_START_PORT } from "@kleiber/shared";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

import { createSigningKey, issueAuthToken, verifyPassword } from "./auth";
import { createAuthPreHandler } from "./middleware";

export interface RemoteApiStore {
  getSettings(): AppSettings;
  setSettings(settings: AppSettings): AppSettings;
  getRemoteApiCredentials(): RemoteApiCredentials | null;
}

export interface RemoteApiServerState {
  host: string;
  port: number;
}

export interface BuildRemoteApiAppOptions {
  getCredentials: () => RemoteApiCredentials | null;
  signingKey: Buffer;
  now?: () => number;
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
  const app = Fastify({
    bodyLimit: 1_000_000,
    logger: false,
  });

  app.decorateRequest("remoteApiAuth", null);

  await app.register(rateLimit, {
    global: false,
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
        options.getCredentials(),
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
    getCredentials: options.getCredentials,
    signingKey: options.signingKey,
  };
  if (options.now) {
    authPreHandlerOptions.now = options.now;
  }

  app.addHook("preHandler", createAuthPreHandler(authPreHandlerOptions));

  app.get("/status", async (request) => {
    return {
      ok: true,
      username: request.remoteApiAuth?.username ?? null,
      authMode: request.remoteApiAuth?.mode ?? null,
    };
  });

  return app;
}

export class RemoteApiServerController {
  readonly #store: RemoteApiStore;
  readonly #now: () => number;
  readonly #signingKey: Buffer;
  #app: FastifyInstance | null = null;
  #state: RemoteApiServerState | null = null;

  constructor(options: {
    store: RemoteApiStore;
    now?: () => number;
  }) {
    this.#store = options.store;
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
      getCredentials: () => this.#store.getRemoteApiCredentials(),
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
