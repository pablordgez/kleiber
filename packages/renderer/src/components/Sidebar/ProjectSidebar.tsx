import React, { useCallback, useState } from 'react';
import { Plus, Settings } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { SidebarItem } from './SidebarItem';
import { Session, UUID } from '@kleiber/shared';
import { StatusBar } from '../StatusBar';
import { NewProjectDialog } from '../Dialogs/NewProjectDialog';

function getSessionDisplayName(session: Session): string {
  return (session as Session & { name?: string }).name ?? session.id.substring(0, 8);
}

/** A flat entry representing a visible sidebar row for keyboard navigation. */
interface NavEntry {
  id: UUID;
  onSelect: () => void;
}

export interface ProjectSidebarProps {
  remoteApiEnabled: boolean;
  remoteApiPort: number | null;
  onNewSession?: (projectId: UUID, parentSessionId?: UUID) => void;
  onOpenSettings?: () => void;
  newProjectOpen?: boolean;
  onNewProjectOpenChange?: (open: boolean) => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  remoteApiEnabled,
  remoteApiPort,
  onNewSession,
  onOpenSettings,
  newProjectOpen,
  onNewProjectOpenChange,
}) => {
  const {
    projects,
    sessions,
    selectedProjectId,
    selectedSessionId,
    expandedIds,
    selectProject,
    selectSession,
    toggleExpanded,
    updateProject,
    removeProject,
  } = useAppStore();

  const [isNewProjectOpenInternal, setIsNewProjectOpenInternal] = useState(false);
  const isNewProjectOpen = newProjectOpen ?? isNewProjectOpenInternal;
  const setIsNewProjectOpen = onNewProjectOpenChange ?? setIsNewProjectOpenInternal;

  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  /** Build the flat list of visible nav entries (projects + visible sessions). */
  const buildNavEntries = useCallback(
    (projectId: UUID, parentId: UUID | null, entries: NavEntry[]): void => {
      const childSessions = sessions.filter(
        (s) => s.projectId === projectId && s.parentSessionId === parentId,
      );
      for (const session of childSessions) {
        entries.push({ id: session.id, onSelect: () => selectSession(session.id) });
        if (expandedIds.has(session.id)) {
          buildNavEntries(projectId, session.id, entries);
        }
      }
    },
    [sessions, expandedIds, selectSession],
  );

  const getNavEntries = useCallback((): NavEntry[] => {
    const entries: NavEntry[] = [];
    for (const project of projects) {
      entries.push({
        id: project.id,
        onSelect: () => {
          selectProject(project.id);
          if (!expandedIds.has(project.id)) toggleExpanded(project.id);
        },
      });
      if (expandedIds.has(project.id)) {
        buildNavEntries(project.id, null, entries);
      }
    }
    return entries;
  }, [projects, expandedIds, selectProject, toggleExpanded, buildNavEntries]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const entries = getNavEntries();
    if (entries.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < entries.length) {
        entries[focusedIndex]?.onSelect();
      }
    }
  };

  const renderSessions = (
    projectId: UUID,
    parentId: UUID | null,
    level: number,
    navEntries: NavEntry[],
  ): React.ReactNode => {
    const childSessions = sessions.filter(
      (s) => s.projectId === projectId && s.parentSessionId === parentId,
    );
    if (childSessions.length === 0) return null;

    return childSessions.map((session) => {
      const isExpanded = expandedIds.has(session.id);
      const hasChildren = sessions.some((s) => s.parentSessionId === session.id);
      const isActive = selectedSessionId === session.id;
      const navIdx = navEntries.findIndex((e) => e.id === session.id);
      const isFocused = navIdx !== -1 && focusedIndex === navIdx;

      return (
        <React.Fragment key={session.id}>
          <SidebarItem
            level={level}
            label={getSessionDisplayName(session)}
            isActive={isActive}
            isFocused={isFocused}
            isExpanded={isExpanded}
            hasChildren={hasChildren}
            statusState={session.state}
            yolo={session.yolo}
            onToggle={() => toggleExpanded(session.id)}
            onSelect={() => selectSession(session.id)}
            contextMenuItems={[
              {
                label: 'New Sub-Session',
                onClick: () => onNewSession?.(projectId, session.id),
              },
              {
                label: 'Kill Session',
                destructive: true,
                onClick: () =>
                  window.kleiber.sessions
                    .kill(session.id)
                    .catch((err: unknown) => console.error('Failed to kill session', err)),
              },
            ]}
          />
          {isExpanded && renderSessions(projectId, session.id, level + 1, navEntries)}
        </React.Fragment>
      );
    });
  };

  const navEntries = getNavEntries();

  return (
    <div
      className="flex flex-col w-[220px] h-full bg-[#000000] border-r border-[#1C1C1C] text-[#FFFFFF] shrink-0"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={() => setFocusedIndex(-1)}
    >
      {/* Header */}
      <div className="px-3 pt-4 pb-3">
        <button
          onClick={() => setIsNewProjectOpen(true)}
          className="flex items-center justify-center w-full gap-2 px-3 py-1.5 text-sm font-medium bg-[#FFFFFF] text-[#000000] rounded-lg hover:bg-[#E5E5E5] transition-colors"
        >
          <Plus size={14} strokeWidth={2} />
          New Project
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {projects.map((project) => {
          const isExpanded = expandedIds.has(project.id);
          const hasChildren = sessions.some(
            (s) => s.projectId === project.id && s.parentSessionId === null,
          );
          const isActive = selectedProjectId === project.id && selectedSessionId === null;
          const navIdx = navEntries.findIndex((e) => e.id === project.id);
          const isFocused = navIdx !== -1 && focusedIndex === navIdx;

          return (
            <React.Fragment key={project.id}>
              <SidebarItem
                level={0}
                label={project.name}
                isActive={isActive}
                isFocused={isFocused}
                isExpanded={isExpanded}
                hasChildren={hasChildren}
                statusState={null}
                yolo={project.yoloDefault}
                onToggle={() => toggleExpanded(project.id)}
                onSelect={() => {
                  selectProject(project.id);
                  if (!isExpanded) toggleExpanded(project.id);
                }}
                contextMenuItems={[
                    {
                      label: 'Rename Project',
                      onClick: () => {
                        const newName = window.prompt('Enter new project name:', project.name);
                        if (newName && newName !== project.name) {
                          window.kleiber.projects
                            .update(project.id, { name: newName })
                            .then(() => updateProject({ ...project, name: newName }))
                            .catch((err: any) => window.alert('Failed to rename project: ' + (err.message || err)));
                        }
                      },
                    },
                  {
                    label: 'New Session',
                    onClick: () => onNewSession?.(project.id),
                  },
                  {
                    label: 'Delete Project',
                    destructive: true,
                    onClick: () =>
                      window.kleiber.projects
                        .remove(project.id)
                        .then(() => removeProject(project.id))
                        .catch((err: unknown) => console.error('Failed to remove project', err)),
                  },
                ]}
              />
              {isExpanded && renderSessions(project.id, null, 1, navEntries)}
            </React.Fragment>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-3 flex flex-col gap-2">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 text-sm text-[#666666] hover:text-[#FFFFFF] transition-colors"
        >
          <Settings size={15} />
          Settings
        </button>
        <StatusBar remoteApiEnabled={remoteApiEnabled} remoteApiPort={remoteApiPort} />
      </div>

      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen} />
    </div>
  );
};
