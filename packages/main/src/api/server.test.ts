import { createServer } from "node:net";

import bcrypt from "bcryptjs";
import type { AppSettings, RemoteApiCredentials } from "@kleiber/shared";
import { afterEach, describe, expect, it } from "vitest";

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
  it("requires auth, issues bearer tokens, and accepts HTTP Basic auth", async () => {
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 12),
    };

    const app = await buildRemoteApiApp({
      getCredentials: () => credentials,
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

    const bearerStatus = await app.inject({
      method: "GET",
      url: "/status",
      headers: {
        authorization: `Bearer ${authBody.token}`,
      },
    });
    expect(bearerStatus.statusCode).toBe(200);
    expect(bearerStatus.json()).toEqual({
      ok: true,
      username: "kleiber",
      authMode: "bearer",
    });

    const basicStatus = await app.inject({
      method: "GET",
      url: "/status",
      headers: {
        authorization: `Basic ${Buffer.from("kleiber:swordfish").toString("base64")}`,
      },
    });
    expect(basicStatus.statusCode).toBe(200);
    expect(basicStatus.json()).toEqual({
      ok: true,
      username: "kleiber",
      authMode: "basic",
    });
  });

  it("rate limits repeated auth requests from the same IP", async () => {
    const credentials: RemoteApiCredentials = {
      username: "kleiber",
      passwordHash: await bcrypt.hash("swordfish", 12),
    };

    const app = await buildRemoteApiApp({
      getCredentials: () => credentials,
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

      const controller = new RemoteApiServerController({
        store: {
          getSettings: () => persistedSettings,
          setSettings: (settings) => {
            persistedSettings = settings;
            return settings;
          },
          getRemoteApiCredentials: () => credentials,
        },
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
