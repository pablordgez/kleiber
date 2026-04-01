import { contextBridge, ipcRenderer } from "electron";
import type { Project, Session, AppSettings, AgentCli, SessionType, UUID } from "@kleiber/shared";

const api = {
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke("projects:list"),
    create: (data: { name: string; directoryPath: string; yoloDefault?: boolean }): Promise<Project> =>
      ipcRenderer.invoke("projects:create", data),
    remove: (id: UUID): Promise<void> => ipcRenderer.invoke("projects:remove", id),
    update: (id: UUID, data: Partial<Pick<Project, "name" | "yoloDefault">>): Promise<void> =>
      ipcRenderer.invoke("projects:update", id, data),
  },
  sessions: {
    list: (projectId: UUID): Promise<Session[]> => ipcRenderer.invoke("sessions:list", projectId),
    create: (data: { projectId: UUID; name: string; type: SessionType; cli?: AgentCli; role?: string; yolo?: boolean }): Promise<Session> =>
      ipcRenderer.invoke("sessions:create", data),
    rename: (id: UUID, name: string): Promise<void> => ipcRenderer.invoke("sessions:rename", id, name),
    send: (id: UUID, input: string): Promise<void> => ipcRenderer.invoke("sessions:send", id, input),
    read: (id: UUID, limit?: number): Promise<string[]> => ipcRenderer.invoke("sessions:read", id, limit),
    kill: (id: UUID): Promise<void> => ipcRenderer.invoke("sessions:kill", id),
    onUpdated: (callback: (session: Session) => void): (() => void) => {
      const channel = "sessions:updated";
      const listener = (_event: Electron.IpcRendererEvent, session: Session): void => callback(session);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
    update: (data: Partial<AppSettings>): Promise<void> => ipcRenderer.invoke("settings:update", data),
  },
  pack: {
    status: (): Promise<{ installed: boolean; version?: string }> => ipcRenderer.invoke("pack:status"),
    install: (): Promise<void> => ipcRenderer.invoke("pack:install"),
    roles: (): Promise<string[]> => ipcRenderer.invoke("pack:roles"),
  },
  terminals: {
    resize: (sessionId: UUID, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke("terminals:resize", sessionId, cols, rows),
    onOutput: (sessionId: UUID, callback: (data: string) => void): (() => void) => {
      const channel = `terminals:output:${sessionId}`;
      const listener = (_event: Electron.IpcRendererEvent, data: string): void => callback(data);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
    onExit: (sessionId: UUID, callback: (exitCode: number | null) => void): (() => void) => {
      const channel = `terminals:exit:${sessionId}`;
      const listener = (_event: Electron.IpcRendererEvent, exitCode: number | null): void => callback(exitCode);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("kleiber", api);

export type KleiberApi = typeof api;
