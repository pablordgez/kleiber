import net from "node:net";
import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import log from "electron-log";

import type { UUID } from "@kleiber/shared";

import type { ParentToWrapperResponse, WrapperToParentRequest } from "./stdio-wrapper";

export interface McpSocketBridgeRuntime {
  pid: null;
  socketPath: string;
  dispose(): Promise<void>;
}

export function resolveMcpSocketPath(sessionId: UUID, workingDirectory?: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\kleiber-mcp-${sessionId}`;
  }

  const socketFileName = `${sessionId.slice(0, 12)}.sock`;
  const baseDirectory = workingDirectory
    ? path.join(workingDirectory, ".kleiber", "mcp")
    : path.join(process.cwd(), ".kleiber", "mcp");
  return path.join(baseDirectory, socketFileName);
}

export async function createMcpSocketBridgeServer(options: {
  sessionId: UUID;
  workingDirectory?: string;
  onRequest: (message: WrapperToParentRequest) => Promise<ParentToWrapperResponse>;
}): Promise<McpSocketBridgeRuntime> {
  const socketPath = resolveMcpSocketPath(options.sessionId, options.workingDirectory);
  log.debug("[mcp] socket bridge init", {
    sessionId: options.sessionId,
    socketPath,
  });
  if (process.platform !== "win32") {
    await mkdir(path.dirname(socketPath), { recursive: true });
    await safeUnlink(socketPath);
  }

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    log.debug("[mcp] socket bridge connected", {
      sessionId: options.sessionId,
      socketPath,
    });
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        void handleSocketMessage(line, socket, options.onRequest);
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
      log.debug("[mcp] socket bridge closed", {
        sessionId: options.sessionId,
        socketPath,
      });
    });
    socket.on("error", (error) => {
      sockets.delete(socket);
      log.error("[mcp] socket bridge socket error", {
        sessionId: options.sessionId,
        socketPath,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      log.debug("[mcp] socket bridge listening", {
        sessionId: options.sessionId,
        socketPath,
      });
      resolve();
    });
  });

  return {
    pid: null,
    socketPath,
    dispose: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      if (process.platform !== "win32") {
        await safeUnlink(socketPath);
      }
    },
  };
}

async function handleSocketMessage(
  rawMessage: string,
  socket: net.Socket,
  onRequest: (message: WrapperToParentRequest) => Promise<ParentToWrapperResponse>,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return;
  }

  if (!isWrapperRequest(parsed)) {
    return;
  }

  log.debug("[mcp] socket bridge request", {
    sessionId: parsed.context.sessionId,
    projectId: parsed.context.projectId,
    method: parsed.method,
  });
  const response = await onRequest(parsed);
  log.debug("[mcp] socket bridge response", {
    sessionId: parsed.context.sessionId,
    method: parsed.method,
    ok: response.ok,
  });
  socket.write(`${JSON.stringify(response)}\n`);
}

function isWrapperRequest(message: unknown): message is WrapperToParentRequest {
  return (
    !!message &&
    typeof message === "object" &&
    (message as WrapperToParentRequest).kind === "kleiber.mcp.request" &&
    typeof (message as WrapperToParentRequest).requestId === "string"
  );
}

async function safeUnlink(targetPath: string): Promise<void> {
  try {
    await unlink(targetPath);
  } catch {
    // Ignore missing or already-cleaned socket paths.
  }
}
