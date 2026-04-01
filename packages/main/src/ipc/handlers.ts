import { ipcMain } from "electron";
import { IPC_CHANNELS, SUPPORTED_AGENT_CLIS } from "@kleiber/shared";
import log from "electron-log";
import type { Project, Session, AgentCli } from "@kleiber/shared";

export function registerIpcHandlers(): void {
  // --- Projects ---
  ipcMain.handle(IPC_CHANNELS.projects.list, async (): Promise<Project[]> => {
    log.debug("IPC: projects:list");
    return [];
  });

  ipcMain.handle(
    IPC_CHANNELS.projects.create,
    async (_e, data: { name: string; directoryPath: string; yoloDefault?: boolean }): Promise<Project> => {
      log.debug("IPC: projects:create", data);
      return {
        id: crypto.randomUUID(),
        name: data.name,
        directoryPath: data.directoryPath,
        yoloDefault: data.yoloDefault ?? false,
        createdAt: new Date().toISOString(),
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.projects.remove, async (_e, id: string): Promise<void> => {
    log.debug("IPC: projects:remove", id);
  });

  ipcMain.handle(IPC_CHANNELS.projects.update, async (_e, id: string, data: unknown): Promise<void> => {
    log.debug("IPC: projects:update", id, data);
  });

  // --- Sessions ---
  ipcMain.handle(IPC_CHANNELS.sessions.list, async (_e, projectId: string): Promise<Session[]> => {
    log.debug("IPC: sessions:list", projectId);
    return [];
  });

  ipcMain.handle(
    IPC_CHANNELS.sessions.create,
    async (
      _e,
      data: { projectId: string; name: string; type: string; cli?: string; role?: string; yolo?: boolean }
    ): Promise<Session> => {
      log.debug("IPC: sessions:create", data);
      return {
        id: crypto.randomUUID(),
        projectId: data.projectId,
        parentSessionId: null,
        type: data.type as "plain" | "agent" | "agent_role",
        cli: (SUPPORTED_AGENT_CLIS as readonly string[]).includes(data.cli ?? "")
          ? (data.cli as AgentCli)
          : null,
        role: data.role ?? null,
        yolo: data.yolo ?? false,
        state: "starting",
        exitCode: null,
        outputBuffer: [],
        mcpEnabled: false,
        mcpWrapperId: null,
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.sessions.rename, async (_e, id: string, name: string): Promise<void> => {
    log.debug("IPC: sessions:rename", id, name);
  });

  ipcMain.handle(IPC_CHANNELS.sessions.send, async (_e, id: string, input: string): Promise<void> => {
    log.debug("IPC: sessions:send", id, input.length, "bytes");
  });

  ipcMain.handle(IPC_CHANNELS.sessions.read, async (_e, id: string, limit?: number): Promise<string[]> => {
    log.debug("IPC: sessions:read", id, limit);
    return [];
  });

  ipcMain.handle(IPC_CHANNELS.sessions.kill, async (_e, id: string): Promise<void> => {
    log.debug("IPC: sessions:kill", id);
  });

  // --- Settings ---
  ipcMain.handle(IPC_CHANNELS.settings.get, async () => {
    log.debug("IPC: settings:get");
    return {
      remoteApiEnabled: false,
      remoteApiPort: null,
      remoteApiBindAddress: "0.0.0.0",
      theme: "dark" as const,
      quickLaunchShortcut: "CmdOrCtrl+K",
    };
  });

  ipcMain.handle(IPC_CHANNELS.settings.update, async (_e, data: unknown): Promise<void> => {
    log.debug("IPC: settings:update", data);
  });

  // --- Pack ---
  ipcMain.handle(IPC_CHANNELS.pack.status, async () => {
    log.debug("IPC: pack:status");
    return { installed: false };
  });

  ipcMain.handle(IPC_CHANNELS.pack.install, async (): Promise<void> => {
    log.debug("IPC: pack:install");
  });

  ipcMain.handle(IPC_CHANNELS.pack.roles, async (): Promise<string[]> => {
    log.debug("IPC: pack:roles");
    return [];
  });

  // --- Terminals ---
  ipcMain.handle(
    IPC_CHANNELS.terminals.resize,
    async (_e, sessionId: string, cols: number, rows: number): Promise<void> => {
      log.debug("IPC: terminals:resize", sessionId, cols, rows);
    }
  );
}
