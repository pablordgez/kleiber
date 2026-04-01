import os
import re

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)

base_dir = '/home/pablo/Desarollo/Agentes/kleiber-t014'

# 1. shared/src/ipc-channels.ts
ipc_channels_path = os.path.join(base_dir, 'packages/shared/src/ipc-channels.ts')
with open(ipc_channels_path, 'r') as f:
    ipc_channels = f.read()

ipc_channels = ipc_channels.replace('kill: "sessions:kill",', 'kill: "sessions:kill",\n    updated: "sessions:updated",')
write_file(ipc_channels_path, ipc_channels)

# 2. preload/src/index.ts
preload_path = os.path.join(base_dir, 'packages/preload/src/index.ts')
with open(preload_path, 'r') as f:
    preload = f.read()

preload = preload.replace('kill: (id: UUID): Promise<void> => ipcRenderer.invoke("sessions:kill", id),',
'''kill: (id: UUID): Promise<void> => ipcRenderer.invoke("sessions:kill", id),
    onUpdated: (callback: (session: Session) => void): (() => void) => {
      const channel = "sessions:updated";
      const listener = (_event: Electron.IpcRendererEvent, session: Session): void => callback(session);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },''')
write_file(preload_path, preload)

# 3. main/src/ipc/handlers.ts
handlers_path = os.path.join(base_dir, 'packages/main/src/ipc/handlers.ts')
handlers_content = '''import { ipcMain, BrowserWindow } from "electron";
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
          requestedYolo: data.yolo,
          name: data.name,
          workingDirectory: data.workingDirectory ?? process.cwd(),
          launch: data.type !== 'plain' ? {
             command: data.cli,
             args: [],
          } : undefined
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
    // We need to implement rename in SessionManager or just store it. Wait, SessionManager has name but no rename method.
    // Let's implement it manually on the record for now if possible, or emit event.
    // Actually, I'll add a patch to SessionManager later or do it directly.
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
      return sessionManager.readSession(id, { limit, plainText: false });
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
'''
write_file(handlers_path, handlers_content)

# 4. Patch sessionManager to add renameSession
session_manager_path = os.path.join(base_dir, 'packages/main/src/sessions/session-manager.ts')
with open(session_manager_path, 'r') as f:
    session_manager = f.read()

rename_method = '''
  renameSession(sessionId: UUID, name: string): void {
    const session = this.#requireSession(sessionId);
    const previousState = session.state;
    session.name = name;
    this.emit("session-updated", {
      session: this.#snapshot(session),
      previousState,
    });
  }

  killSession'''

session_manager = session_manager.replace('  killSession', rename_method)
write_file(session_manager_path, session_manager)

# 5. Add call to renameSession in handlers.ts
with open(handlers_path, 'r') as f:
    handlers = f.read()
handlers = handlers.replace(
'''  ipcMain.handle(IPC_CHANNELS.sessions.rename, async (_e, id: string, name: string): Promise<void> => {
    // We need to implement rename in SessionManager or just store it. Wait, SessionManager has name but no rename method.
    // Let's implement it manually on the record for now if possible, or emit event.
    // Actually, I'll add a patch to SessionManager later or do it directly.
  });''',
'''  ipcMain.handle(IPC_CHANNELS.sessions.rename, async (_e, id: string, name: string): Promise<void> => {
    try {
      sessionManager.renameSession(id, name);
    } catch (e) {
      log.error(e);
    }
  });''')
write_file(handlers_path, handlers)

# 6. TerminalPane.tsx
terminal_pane_path = os.path.join(base_dir, 'packages/renderer/src/components/Terminal/TerminalPane.tsx')
terminal_pane_content = '''import React, { useEffect, useRef, useState } from 'react';
import { UUID } from '@kleiber/shared';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export interface TerminalPaneProps {
  sessionId: UUID;
  sessionName: string;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ sessionId, sessionName }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    term.current = new Terminal({
      theme: {
        background: '#09090B',
        foreground: '#A1A1AA',
      },
      fontFamily: 'monospace',
      fontSize: 14,
    });
    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);
    
    term.current.open(terminalRef.current);
    fitAddon.current.fit();

    const onDataDisposable = term.current.onData((data) => {
      window.kleiber.sessions.send(sessionId, data).catch(err => {
        if (!error) setError(err.message);
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && term.current) {
        fitAddon.current.fit();
        window.kleiber.terminals.resize(sessionId, term.current.cols, term.current.rows).catch(err => {
          console.error('Resize failed', err);
        });
      }
    });
    resizeObserver.observe(terminalRef.current);

    // Initial output load
    window.kleiber.sessions.read(sessionId).then((lines) => {
      if (term.current) {
        for (const line of lines) {
          term.current.write(line + '\\r\\n');
        }
      }
    }).catch(err => setError(err.message));

    const removeOutputListener = window.kleiber.terminals.onOutput(sessionId, (data) => {
      if (term.current) {
        term.current.write(data);
      }
    });

    const removeExitListener = window.kleiber.terminals.onExit(sessionId, (exitCode) => {
      if (term.current) {
        term.current.write(`\\r\\n\\x1b[31m[Session exited with code ${exitCode}]\\x1b[0m\\r\\n`);
      }
    });

    return () => {
      onDataDisposable.dispose();
      resizeObserver.disconnect();
      removeOutputListener();
      removeExitListener();
      term.current?.dispose();
    };
  }, [sessionId]);

  return (
    <div className="flex-1 w-full h-full relative flex flex-col" style={{ minHeight: 0 }}>
      {error && <div className="bg-red-900/50 text-red-200 p-2 text-xs font-mono border-b border-red-900">{error}</div>}
      <div className="flex-1 relative">
        <div ref={terminalRef} className="absolute inset-0 p-2" />
      </div>
    </div>
  );
};
'''
write_file(terminal_pane_path, terminal_pane_content)

print("Done")
