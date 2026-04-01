import os

base_dir = '/home/pablo/Desarollo/Agentes/kleiber-t014'

# Fix App.tsx global types
app_path = os.path.join(base_dir, 'packages/renderer/src/App.tsx')
with open(app_path, 'r') as f:
    app = f.read()

app = app.replace(
'''      sessions: {
        onUpdated: (callback: (session: Session) => void) => (() => void);
        list: (projectId: UUID) => Promise<Session[]>;
        create: (data: {
          projectId: UUID;
          name: string;
          type: SessionType;
          cli?: AgentCli;
          role?: string;
          yolo?: boolean;
          parentSessionId?: UUID;
        }) => Promise<Session>;
        kill: (id: UUID) => Promise<void>;
        rename: (id: UUID, name: string) => Promise<void>;
      };''',
'''      sessions: {
        onUpdated: (callback: (session: Session) => void) => (() => void);
        list: (projectId: UUID) => Promise<Session[]>;
        create: (data: {
          projectId: UUID;
          name: string;
          type: SessionType;
          cli?: AgentCli;
          role?: string;
          yolo?: boolean;
          parentSessionId?: UUID;
        }) => Promise<Session>;
        kill: (id: UUID) => Promise<void>;
        rename: (id: UUID, name: string) => Promise<void>;
        send: (id: UUID, input: string) => Promise<void>;
        read: (id: UUID, limit?: number) => Promise<string[]>;
      };
      terminals: {
        resize: (id: UUID, cols: number, rows: number) => Promise<void>;
        onOutput: (id: UUID, callback: (data: string) => void) => (() => void);
        onExit: (id: UUID, callback: (code: number | null) => void) => (() => void);
      };''')

with open(app_path, 'w') as f:
    f.write(app)

# Fix handlers.ts
handlers_path = os.path.join(base_dir, 'packages/main/src/ipc/handlers.ts')
with open(handlers_path, 'r') as f:
    handlers = f.read()

handlers = handlers.replace(
'''          launch: data.type !== 'plain' ? {
             command: data.cli,
             args: [],
          } : undefined
        });''',
'''          ...(data.type !== 'plain' && data.cli ? {
             launch: {
               command: data.cli,
               args: [],
             }
          } : {})
        });''')

handlers = handlers.replace(
'''  ipcMain.handle(IPC_CHANNELS.sessions.read, async (_e, id: string, limit?: number): Promise<string[]> => {
    try {
      return sessionManager.readSession(id, { limit, plainText: false });
    } catch {
      return [];
    }
  });''',
'''  ipcMain.handle(IPC_CHANNELS.sessions.read, async (_e, id: string, limit?: number): Promise<string[]> => {
    try {
      const options: any = { plainText: false };
      if (limit !== undefined) options.limit = limit;
      return sessionManager.readSession(id, options);
    } catch {
      return [];
    }
  });''')

with open(handlers_path, 'w') as f:
    f.write(handlers)

# Fix TerminalPane.tsx types
terminal_pane_path = os.path.join(base_dir, 'packages/renderer/src/components/Terminal/TerminalPane.tsx')
with open(terminal_pane_path, 'r') as f:
    terminal_pane = f.read()

terminal_pane = terminal_pane.replace('.catch(err => {', '.catch((err: any) => {')
terminal_pane = terminal_pane.replace('.catch(err => setError(err.message));', '.catch((err: any) => setError(err.message));')
terminal_pane = terminal_pane.replace('(data) => {', '(data: string) => {')
terminal_pane = terminal_pane.replace('(exitCode) => {', '(exitCode: number | null) => {')

with open(terminal_pane_path, 'w') as f:
    f.write(terminal_pane)

print("TS files fixed")
