import React, { useEffect, useState } from 'react';
import { AppSettings, Project, Session, UUID, SessionType, AgentCli } from '@kleiber/shared';
import { useAppStore } from './store/useAppStore';
import { ProjectSidebar } from './components/Sidebar/ProjectSidebar';
import { ProjectOverview } from './components/ProjectOverview';
import { SessionHeader } from './components/Terminal/SessionHeader';
import { TerminalPane } from './components/Terminal/TerminalPane';
import { NewSessionDialog } from './components/Dialogs/NewSessionDialog';

declare global {
  interface Window {
    kleiber: {
      projects: {
        list: () => Promise<Project[]>;
        create: (data: {
          name: string;
          directoryPath: string;
          yoloDefault?: boolean;
        }) => Promise<Project>;
        remove: (id: UUID) => Promise<void>;
      };
      sessions: {
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
      };
      settings: {
        get: () => Promise<AppSettings>;
      };
      pack: {
        status: () => Promise<{ installed: boolean }>;
      };
    };
  }
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
  } = useAppStore();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<UUID | null>(null);

  // Ensure dark mode class is on html
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Initialize: load settings + projects
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

  // Load sessions whenever selected project changes
  useEffect(() => {
    if (selectedProjectId) {
      window.kleiber.sessions
        .list(selectedProjectId)
        .then(setSessions)
        .catch((err: unknown) => console.error('Failed to load sessions', err));
    }
  }, [selectedProjectId, setSessions]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        if (selectedProjectId) {
          setNewSessionProjectId(selectedProjectId);
          setIsNewSessionOpen(true);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        // Settings — placeholder for future milestone
        console.log('Settings shortcut — not yet implemented');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  const getAncestorNames = (sessionId: UUID): string[] => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !session.parentSessionId) return [];
    const parent = sessions.find((s) => s.id === session.parentSessionId);
    if (!parent) return [];
    return [...getAncestorNames(parent.id), parent.id.substring(0, 8)];
  };

  const handleNewSession = (projectId: UUID) => {
    setNewSessionProjectId(projectId);
    setIsNewSessionOpen(true);
  };

  const activeProjectForDialog =
    newSessionProjectId != null
      ? (projects.find((p) => p.id === newSessionProjectId) ?? selectedProject)
      : selectedProject;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090B] text-[#FAFAFA] font-sans">
      <ProjectSidebar
        remoteApiEnabled={settings?.remoteApiEnabled ?? false}
        remoteApiPort={settings?.remoteApiPort ?? null}
        onNewSession={handleNewSession}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedProjectId ? (
          <div className="flex-1 flex items-center justify-center text-[#A1A1AA] text-sm">
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
                  .then(() => removeSession(selectedSession.id))
                  .catch((err: unknown) => console.error('Failed to kill session', err))
              }
            />
            <TerminalPane
              sessionId={selectedSession.id}
              sessionName={selectedSession.id.substring(0, 8)}
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

      {activeProjectForDialog && (
        <NewSessionDialog
          open={isNewSessionOpen}
          onOpenChange={(open) => {
            setIsNewSessionOpen(open);
            if (!open) setNewSessionProjectId(null);
          }}
          projectId={activeProjectForDialog.id}
          projectYoloDefault={activeProjectForDialog.yoloDefault}
        />
      )}
    </div>
  );
};

export default App;
