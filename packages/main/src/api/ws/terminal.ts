import type { FastifyInstance } from "fastify";

import { verifyAuthToken } from "../auth";
import type { RemoteApiSessionManager } from "../types";

const DEFAULT_AUTH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONNECTIONS_PER_USER = 10;
export const DEFAULT_MAX_WS_PAYLOAD_BYTES = 64 * 1024;

interface WsContext {
  authenticatedUser: string | null;
}

interface WebSocketLike {
  readonly readyState: number;
  send(payload: string): void;
  close(code: number, reason: string): void;
  terminate?(): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

function sendJson(socket: WebSocketLike, payload: unknown): void {
  socket.send(JSON.stringify(payload));
}

function closeSocket(socket: WebSocketLike, code: number, reason: string): void {
  if (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING) {
    socket.close(code, reason);
    if (typeof socket.terminate === "function") {
      setTimeout(() => {
        if (socket.readyState !== SOCKET_CLOSED) {
          socket.terminate?.();
        }
      }, 50).unref();
    }
  }
}

function parseJsonMessage(rawMessage: unknown): Record<string, unknown> | null {
  try {
    const text =
      typeof rawMessage === "string"
        ? rawMessage
        : Buffer.isBuffer(rawMessage)
          ? rawMessage.toString("utf8")
          : Array.isArray(rawMessage)
            ? Buffer.concat(rawMessage).toString("utf8")
            : rawMessage instanceof ArrayBuffer
              ? Buffer.from(rawMessage).toString("utf8")
              : null;
    if (!text) {
      return null;
    }

    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function registerTerminalWebSocketRoutes(
  app: FastifyInstance,
  options: {
    sessionManager: Pick<
      RemoteApiSessionManager,
      "getSession" | "readSession" | "sendToSession" | "on" | "removeListener"
    >;
    signingKey: Buffer;
    now?: () => number;
    authTimeoutMs?: number;
    maxConnectionsPerUser?: number;
    maxPayloadBytes?: number;
  },
): Promise<void> {
  const authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const maxConnectionsPerUser = options.maxConnectionsPerUser ?? DEFAULT_MAX_CONNECTIONS_PER_USER;
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_WS_PAYLOAD_BYTES;
  const now = options.now ?? (() => Date.now());
  const activeConnectionsByUser = new Map<string, number>();

  function incrementConnections(username: string): boolean {
    const current = activeConnectionsByUser.get(username) ?? 0;
    if (current >= maxConnectionsPerUser) {
      return false;
    }

    activeConnectionsByUser.set(username, current + 1);
    return true;
  }

  function decrementConnections(username: string | null): void {
    if (!username) {
      return;
    }

    const current = activeConnectionsByUser.get(username);
    if (!current || current <= 1) {
      activeConnectionsByUser.delete(username);
      return;
    }

    activeConnectionsByUser.set(username, current - 1);
  }

  function attachAuthenticationGate(
    socket: WebSocketLike,
    onAuthenticated: (username: string) => void,
  ): void {
    const context: WsContext = { authenticatedUser: null };
    const authTimer = setTimeout(() => {
      if (!context.authenticatedUser) {
        closeSocket(socket, 4401, "Authentication timeout");
      }
    }, authTimeoutMs);

    const authenticate = (rawMessage: unknown): string | null => {
      const messageSize = Buffer.byteLength(
        typeof rawMessage === "string" ? rawMessage : Buffer.isBuffer(rawMessage) ? rawMessage : Buffer.from(String(rawMessage)),
      );
      if (messageSize > maxPayloadBytes) {
        closeSocket(socket, 1009, "Payload too large");
        return null;
      }

      const message = parseJsonMessage(rawMessage);
      const token = typeof message?.token === "string" ? message.token : null;
      if (!token) {
        closeSocket(socket, 4401, "JWT token required in first message");
        return null;
      }

      const payload = verifyAuthToken(token, options.signingKey, now);
      if (!payload) {
        closeSocket(socket, 4401, "Invalid token");
        return null;
      }

      if (!incrementConnections(payload.sub)) {
        closeSocket(socket, 4409, "Connection limit exceeded");
        return null;
      }

      context.authenticatedUser = payload.sub;
      clearTimeout(authTimer);
      onAuthenticated(payload.sub);
      sendJson(socket, { type: "ready", username: payload.sub });
      return payload.sub;
    };

    socket.once("message", authenticate);
    socket.once("close", () => {
      clearTimeout(authTimer);
      decrementConnections(context.authenticatedUser);
    });
  }

  app.get(
    "/ws/sessions/:sessionId/output",
    { websocket: true },
    (socket, request) => {
      const { sessionId } = request.params as { sessionId: string };
      let outputListener: ((payload: { sessionId: string; chunk: string }) => void) | null = null;
      let exitListener:
        | ((payload: { session: { id: string; exitCode: number | null; signal?: number | string | null } }) => void)
        | null = null;
      // Hoisted so the close handler can cancel the pending batch timer.
      let cancelBatch: (() => void) | null = null;

      attachAuthenticationGate(socket, () => {
        const session = options.sessionManager.getSession(sessionId);
        if (!session) {
          closeSocket(socket, 4404, "Unknown session");
          return;
        }

        const shouldSendSnapshot = session.type === "plain";
        const bufferedOutput = shouldSendSnapshot
          ? options.sessionManager.readSession(sessionId, {
              plainText: false,
            })
          : [];
        if (shouldSendSnapshot && bufferedOutput.length > 0) {
          sendJson(socket, {
            type: "snapshot",
            sessionId,
            output: bufferedOutput.join("\n"),
          });
        }

        // Batch output chunks for up to 16 ms to reduce WebSocket message
        // frequency on high-throughput sessions.
        const WS_BATCH_INTERVAL_MS = 16;
        const WS_BATCH_MAX_BYTES = 64 * 1024;
        let wsBatchData = "";
        let wsBatchTimer: ReturnType<typeof setTimeout> | null = null;

        function flushWsBatch(): void {
          if (wsBatchTimer !== null) {
            clearTimeout(wsBatchTimer);
            wsBatchTimer = null;
          }
          if (wsBatchData.length === 0) return;
          const data = wsBatchData;
          wsBatchData = "";
          sendJson(socket, { type: "output", sessionId, data });
        }

        cancelBatch = () => {
          if (wsBatchTimer !== null) {
            clearTimeout(wsBatchTimer);
            wsBatchTimer = null;
          }
          wsBatchData = "";
        };

        outputListener = (payload) => {
          if (payload.sessionId !== sessionId) return;
          if (wsBatchTimer !== null) clearTimeout(wsBatchTimer);
          wsBatchData += payload.chunk;
          if (wsBatchData.length >= WS_BATCH_MAX_BYTES) {
            flushWsBatch();
            return;
          }
          wsBatchTimer = setTimeout(flushWsBatch, WS_BATCH_INTERVAL_MS);
        };
        exitListener = (payload) => {
          if (payload.session.id === sessionId) {
            // Flush any buffered data before sending the exit notification.
            flushWsBatch();
            sendJson(socket, {
              type: "exit",
              sessionId,
              exitCode: payload.session.exitCode,
              signal: payload.session.signal ?? null,
            });
          }
        };

        options.sessionManager.on("session-output", outputListener);
        options.sessionManager.on("session-exited", exitListener);
      });

      socket.once("close", () => {
        if (outputListener) {
          options.sessionManager.removeListener("session-output", outputListener);
        }
        if (exitListener) {
          options.sessionManager.removeListener("session-exited", exitListener);
        }
        cancelBatch?.();
      });

    },
  );

  app.get(
    "/ws/sessions/:sessionId/input",
    { websocket: true },
    (socket, request) => {
      const { sessionId } = request.params as { sessionId: string };

      attachAuthenticationGate(socket, () => {
        const session = options.sessionManager.getSession(sessionId);
        if (!session) {
          closeSocket(socket, 4404, "Unknown session");
          return;
        }

        socket.on("message", (rawMessage: unknown) => {
          const messageSize = Buffer.byteLength(
            typeof rawMessage === "string" ? rawMessage : Buffer.isBuffer(rawMessage) ? rawMessage : Buffer.from(String(rawMessage)),
          );
          if (messageSize > maxPayloadBytes) {
            closeSocket(socket, 1009, "Payload too large");
            return;
          }

          const message = parseJsonMessage(rawMessage);
          const input = typeof message?.input === "string" ? message.input : null;
          if (input === null) {
            closeSocket(socket, 4400, "Input payload required");
            return;
          }

          try {
            options.sessionManager.sendToSession(sessionId, input);
            sendJson(socket, { type: "accepted", sessionId, length: input.length });
          } catch (error) {
            sendJson(socket, {
              type: "error",
              sessionId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        });
      });
    },
  );
}
