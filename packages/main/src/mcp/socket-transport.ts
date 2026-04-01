import net from "node:net";
import os from "node:os";
import path from "node:path";
import { unlink } from "node:fs/promises";

import type { UUID } from "@kleiber/shared";

import type { ParentToWrapperResponse, WrapperToParentRequest } from "./stdio-wrapper";

export interface McpSocketBridgeRuntime {
  pid: null;
  socketPath: string;
  dispose(): Promise<void>;
}

export function resolveMcpSocketPath(sessionId: UUID): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\kleiber-mcp-${sessionId}`;
  }

  return path.join(os.tmpdir(), `kleiber-mcp-${sessionId}.sock`);
}

export async function createMcpSocketBridgeServer(options: {
  sessionId: UUID;
  onRequest: (message: WrapperToParentRequest) => Promise<ParentToWrapperResponse>;
}): Promise<McpSocketBridgeRuntime> {
  const socketPath = resolveMcpSocketPath(options.sessionId);
  if (process.platform !== "win32") {
    await safeUnlink(socketPath);
  }

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
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
    });
    socket.on("error", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
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

  const response = await onRequest(parsed);
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
