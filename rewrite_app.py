import os
import re

base_dir = '/home/pablo/Desarollo/Agentes/kleiber-t014'

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)

# 1. Update useAppStore.ts
app_store_path = os.path.join(base_dir, 'packages/renderer/src/store/useAppStore.ts')
with open(app_store_path, 'r') as f:
    app_store = f.read()

app_store = app_store.replace(
'''  removeSession: (id: UUID) => void;
  loadProjects: () => Promise<void>;
}''',
'''  removeSession: (id: UUID) => void;
  updateSession: (session: Session) => void;
  loadProjects: () => Promise<void>;
}''')

app_store = app_store.replace(
'''  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
    })),
  loadProjects: async () => {''',
'''  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
    })),
  updateSession: (session) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
    })),
  loadProjects: async () => {''')

write_file(app_store_path, app_store)

# 2. Update App.tsx
app_path = os.path.join(base_dir, 'packages/renderer/src/App.tsx')
with open(app_path, 'r') as f:
    app = f.read()

app = app.replace(
'''      sessions: {
        list: (projectId: UUID) => Promise<Session[]>;
        create: (data: {''',
'''      sessions: {
        onUpdated: (callback: (session: Session) => void) => (() => void);
        list: (projectId: UUID) => Promise<Session[]>;
        create: (data: {''')

app = app.replace(
'''    loadProjects,
    setSessions,
    selectSession,
    removeSession,
  } = useAppStore();''',
'''    loadProjects,
    setSessions,
    selectSession,
    removeSession,
    updateSession,
  } = useAppStore();''')

app = app.replace(
'''  // Load sessions whenever selected project changes
  useEffect(() => {
    if (selectedProjectId) {
      window.kleiber.sessions
        .list(selectedProjectId)
        .then(setSessions)
        .catch((err: unknown) => console.error('Failed to load sessions', err));
    }
  }, [selectedProjectId, setSessions]);''',
'''  // Load sessions whenever selected project changes
  useEffect(() => {
    if (selectedProjectId) {
      window.kleiber.sessions
        .list(selectedProjectId)
        .then(setSessions)
        .catch((err: unknown) => console.error('Failed to load sessions', err));
    }
  }, [selectedProjectId, setSessions]);

  useEffect(() => {
    const unsubscribe = window.kleiber.sessions.onUpdated((session) => {
      updateSession(session);
    });
    return () => unsubscribe();
  }, [updateSession]);''')

app = app.replace(
'''              onKill={() =>
                window.kleiber.sessions
                  .kill(selectedSession.id)
                  .then(() => removeSession(selectedSession.id))
                  .catch((err: unknown) => console.error('Failed to kill session', err))
              }''',
'''              onKill={() =>
                window.kleiber.sessions
                  .kill(selectedSession.id)
                  .catch((err: unknown) => console.error('Failed to kill session', err))
              }''')

write_file(app_path, app)

print("App updated")
