import { ipcMain, BrowserWindow } from "electron";
import { IPC_CHANNELS, SUPPORTED_AGENT_CLIS } from "@kleiber/shared";
import log from "electron-log";
import type { Project, Session, AgentCli } from "@kleiber/shared";
import { SessionManager } from "../sessions/session-manager";

export const sessionManager = new SessionManager();

sessionManager.on("session-output", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(`terminals:output:${payload.sessionId}`, payload.chunk));
});
sessionManager.on("session-exited", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(`terminals:exit:${payload.session.id}`, payload.session.exitCode));
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IPC_CHANNELS.sessions.updated, payload.session));
});
sessionManager.on("session-created", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IPC_CHANNELS.sessions.updated, payload.session));
});
sessionManager.on("session-updated", (payload) => {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IPC_CHANNELS.sessions.updated, payload.session));
});

export function registerIpcHandlers(): void {
  // --- Projects ---
  ipcMain.handle(IPC_CHANNELS.projects.list, async (): Promise<Project[]> => {
    return [];
  });
  ipcMain.handle(IPC_CHANNELS.projects.create, async (_e, data: any): Promise<Project> => {
    return { id: crypto.randomUUID(), name: data.name, directoryPath: data.directoryPath, yoloDefault: data.yoloDefault ?? false, createdAt: new Date().toISOString() };
  });
  ipcMain.handle(IPC_CHANNELS.projects.remove, async (_e, id: string): Promise<void> => {});
  ipcMain.handle(IPC_CHANNELS.projects.update, async (_e, id: string, data: unknown): Promise<void> => {});

  // --- Sessions ---
  ipcMain.handle(IPC_CHANNELS.sessions.list, async (_e, projectId: string): Promise<Session[]> => {
    return sessionManager.listSessions(projectId) as unknown as Session[];
  });

  ipcMain.handle(
    IPC_CHANNELS.sessions.create,
    async (
      _e,
      data: { projectId: string; name: string; type: string; cli?: string; role?: string; yolo?: boolean; workingDirectory?: string }
    ): Promise<Session> => {
      try {
        const session = await sessionManager.createSession({
          projectId: data.projectId,
          type: data.type as any,
          cli: (data.cli as AgentCli) ?? null,
          role: data.role ?? null,
          ...(data.yolo !== undefined ? { requestedYolo: data.yolo } : {}),
          name: data.name,
          workingDirectory: data.workingDirectory ?? process.cwd(),
          ...(data.type !== 'plain' && data.cli ? {
             launch: {
               command: data.cli,
               args: [],
             }
          } : {})
        });
        return session as unknown as Session;
      } catch (e: any) {
        log.error("Failed to create session", e);
        // CLI not found or other error
        throw e;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.sessions.rename, async (_e, id: string, name: string): Promise<void> => {
    try {
      sessionManager.renameSession(id, name);
    } catch (e) {
      log.error(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessions.send, async (_e, id: string, input: string): Promise<void> => {
    try {
      sessionManager.sendToSession(id, input);
    } catch (e) {
      log.error(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessions.read, async (_e, id: string, limit?: number): Promise<string[]> => {
    try {
      const options: any = { plainText: false };
      if (limit !== undefined) options.limit = limit;
      return sessionManager.readSession(id, options);
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessions.kill, async (_e, id: string): Promise<void> => {
    try {
      sessionManager.killSession(id);
    } catch (e) {
      log.error(e);
    }
  });

  // --- Settings ---
  ipcMain.handle(IPC_CHANNELS.settings.get, async () => ({
    remoteApiEnabled: false, remoteApiPort: null, remoteApiBindAddress: "0.0.0.0", theme: "dark", quickLaunchShortcut: "CmdOrCtrl+K"
  }));
  ipcMain.handle(IPC_CHANNELS.settings.update, async (_e, data: unknown): Promise<void> => {});

  // --- Pack ---
  ipcMain.handle(IPC_CHANNELS.pack.status, async () => ({ installed: false }));
  ipcMain.handle(IPC_CHANNELS.pack.install, async (): Promise<void> => {});
  ipcMain.handle(IPC_CHANNELS.pack.roles, async (): Promise<string[]> => []);

  // --- Terminals ---
  ipcMain.handle(
    IPC_CHANNELS.terminals.resize,
    async (_e, sessionId: string, cols: number, rows: number): Promise<void> => {
      try {
        sessionManager.resizeSession(sessionId, { columns: cols, rows });
      } catch (e) {
        log.error(e);
      }
    }
  );
}
