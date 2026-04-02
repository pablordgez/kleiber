import React, { useEffect, useState } from 'react';
import { AppSettings, Session, Theme, UUID } from '@kleiber/shared';
import { useAppStore } from './store/useAppStore';
import { ProjectSidebar } from './components/Sidebar/ProjectSidebar';
import { AgentPackBanner } from './components/AgentPackBanner';
import { ProjectOverview } from './components/ProjectOverview';
import { SessionHeader } from './components/Terminal/SessionHeader';
import { TerminalPane } from './components/Terminal/TerminalPane';
import { NewSessionDialog } from './components/Dialogs/NewSessionDialog';
import { SettingsPanel } from './components/Settings/SettingsPanel';

function getSessionDisplayName(session: Session): string {
  return (session as Session & { name?: string }).name ?? session.id.substring(0, 8);
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export const App: React.FC = () => {
  const {
    projects,
    sessions,
    selectedProjectId,
    selectedSessionId,
    loadProjects,
    setSessions,
    selectSession,
    removeSession,
    updateSession,
  } = useAppStore();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<UUID | null>(null);
  const [newSessionParentId, setNewSessionParentId] = useState<UUID | null>(null);

  useEffect(() => {
    applyTheme(settings?.theme ?? 'dark');
  }, [settings?.theme]);

  useEffect(() => {
    const init = async () => {
      try {
        const appSettings = await window.kleiber.settings.get();
        setSettings(appSettings);
        await loadProjects();
      } catch (err) {
        console.error('Failed to initialize app', err);
      }
    };
    init();
  }, [loadProjects]);

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
  }, [updateSession]);

  useEffect(() => {
    const unsubscribe = window.kleiber.sessions.onRemoved((sessionIds) => {
      for (const sessionId of sessionIds) {
        removeSession(sessionId);
      }
    });
    return () => unsubscribe();
  }, [removeSession]);

  useEffect(() => {
    const unsubNewProject = window.kleiber.shortcuts.onNewProject(() => {
      setIsNewProjectOpen(true);
    });
    const unsubNewSession = window.kleiber.shortcuts.onNewSession(() => {
      if (selectedProjectId) {
        setNewSessionProjectId(selectedProjectId);
        setIsNewSessionOpen(true);
      }
    });
    const unsubNewSubSession = window.kleiber.shortcuts.onNewSubSession(() => {
      if (selectedProjectId) {
        setNewSessionProjectId(selectedProjectId);
        if (selectedSessionId) {
          setNewSessionParentId(selectedSessionId);
        }
        setIsNewSessionOpen(true);
      }
    });
    const unsubKillSession = window.kleiber.shortcuts.onKillSession(() => {
      if (selectedSessionId) {
        window.kleiber.sessions
          .kill(selectedSessionId)
          .catch((err: unknown) => console.error('Failed to kill session', err));
      }
    });
    const unsubOpenSettings = window.kleiber.shortcuts.onOpenSettings(() => {
      setIsSettingsOpen(true);
    });
    return () => {
      unsubNewProject();
      unsubNewSession();
      unsubNewSubSession();
      unsubKillSession();
      unsubOpenSettings();
    };
  }, [selectedProjectId, selectedSessionId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const projectSessions = selectedProjectId
    ? sessions.filter((session) => session.projectId === selectedProjectId)
    : [];

  const getAncestorNames = (sessionId: UUID): string[] => {
    const names: string[] = [];
    let current = sessions.find((session) => session.id === sessionId) ?? null;

    while (current?.parentSessionId) {
      const parent = sessions.find((session) => session.id === current?.parentSessionId) ?? null;
      if (!parent) break;
      names.unshift(getSessionDisplayName(parent));
      current = parent;
    }

    return names;
  };

  const handleNewSession = (projectId: UUID, parentSessionId?: UUID) => {
    setNewSessionProjectId(projectId);
    setNewSessionParentId(parentSessionId ?? null);
    setIsNewSessionOpen(true);
  };

  const activeProjectForDialog =
    newSessionProjectId != null
      ? (projects.find((p) => p.id === newSessionProjectId) ?? selectedProject)
      : selectedProject;
  const parentSessionDialogProps = newSessionParentId
    ? { parentSessionId: newSessionParentId }
    : {};

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#000000] text-[#FFFFFF] font-sans">
      <ProjectSidebar
        remoteApiEnabled={settings?.remoteApiEnabled ?? false}
        remoteApiPort={settings?.remoteApiPort ?? null}
        onNewSession={handleNewSession}
        onOpenSettings={() => setIsSettingsOpen(true)}
        newProjectOpen={isNewProjectOpen}
        onNewProjectOpenChange={setIsNewProjectOpen}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AgentPackBanner />

        {selectedProject && projectSessions.length > 0 && (
          <div className="h-9 shrink-0 border-b border-[#1C1C1C] bg-[#000000] px-3 flex items-center gap-0.5 overflow-x-auto">
            <button
              onClick={() => selectSession(null)}
              className={`h-7 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedSessionId === null
                  ? 'bg-[#141414] text-[#FFFFFF]'
                  : 'text-[#666666] hover:text-[#FFFFFF] hover:bg-[#0A0A0A]'
              }`}
            >
              Overview
            </button>
            {projectSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => selectSession(session.id)}
                className={`h-7 max-w-[200px] px-3 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-2 transition-colors ${
                  selectedSessionId === session.id
                    ? 'bg-[#141414] text-[#FFFFFF]'
                    : 'text-[#666666] hover:text-[#FFFFFF] hover:bg-[#0A0A0A]'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    session.state === 'running'
                      ? 'bg-[#22C55E]'
                      : session.state === 'starting'
                        ? 'bg-[#F59E0B]'
                        : 'bg-[#666666]'
                  }`}
                />
                <span className="truncate">{getSessionDisplayName(session)}</span>
              </button>
            ))}
          </div>
        )}

        {!selectedProjectId ? (
          <div className="flex-1 flex items-center justify-center text-[#666666] text-sm">
            <p>Select a project to get started</p>
          </div>
        ) : selectedSession ? (
          <>
            <SessionHeader
              session={selectedSession}
              projectName={selectedProject?.name ?? 'Unknown Project'}
              ancestorNames={getAncestorNames(selectedSession.id)}
              onKill={() =>
                window.kleiber.sessions
                  .kill(selectedSession.id)
                  .catch((err: unknown) => console.error('Failed to kill session', err))
              }
              onDelete={() =>
                window.kleiber.sessions
                  .delete(selectedSession.id)
                  .catch((err: unknown) => console.error('Failed to delete session', err))
              }
            />
            <TerminalPane
              sessionId={selectedSession.id}
              state={selectedSession.state}
              theme={settings?.theme ?? 'dark'}
            />
          </>
        ) : selectedProject ? (
          <ProjectOverview
            project={selectedProject}
            sessions={sessions}
            onNewSession={() => handleNewSession(selectedProject.id)}
            onSelectSession={selectSession}
          />
        ) : null}
      </main>

      <SettingsPanel
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSettingsChange={setSettings}
      />

      {activeProjectForDialog && (
        <NewSessionDialog
          open={isNewSessionOpen}
          onOpenChange={(open) => {
            setIsNewSessionOpen(open);
            if (!open) {
              setNewSessionProjectId(null);
              setNewSessionParentId(null);
            }
          }}
          projectId={activeProjectForDialog.id}
          {...parentSessionDialogProps}
          onCreated={(session) => selectSession(session.id)}
        />
      )}
    </div>
  );
};

export default App;
