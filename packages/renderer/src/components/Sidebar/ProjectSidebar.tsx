import React, { useState } from 'react';
import { Plus, Settings } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { SidebarItem } from './SidebarItem';
import { UUID } from '@kleiber/shared';
import { StatusBar } from '../StatusBar';
import { NewProjectDialog } from '../Dialogs/NewProjectDialog';

export interface ProjectSidebarProps {
  remoteApiEnabled: boolean;
  remoteApiPort: number | null;
  onNewSession?: (projectId: UUID) => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  remoteApiEnabled,
  remoteApiPort,
  onNewSession,
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
    removeProject,
    removeSession,
  } = useAppStore();

  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  const renderSessions = (projectId: UUID, parentId: UUID | null, level: number): React.ReactNode => {
    const childSessions = sessions.filter(
      (s) => s.projectId === projectId && s.parentSessionId === parentId,
    );
    if (childSessions.length === 0) return null;

    return childSessions.map((session) => {
      const isExpanded = expandedIds.has(session.id);
      const hasChildren = sessions.some((s) => s.parentSessionId === session.id);
      const isActive = selectedSessionId === session.id;

      return (
        <React.Fragment key={session.id}>
          <SidebarItem
            level={level}
            label={session.id.substring(0, 8)}
            isActive={isActive}
            isExpanded={isExpanded}
            hasChildren={hasChildren}
            statusState={session.state}
            yolo={session.yolo}
            onToggle={() => toggleExpanded(session.id)}
            onSelect={() => selectSession(session.id)}
            contextMenuItems={[
              {
                label: 'New Sub-Session',
                onClick: () => onNewSession?.(projectId),
              },
              {
                label: 'Kill Session',
                destructive: true,
                onClick: () =>
                  window.kleiber.sessions
                    .kill(session.id)
                    .then(() => removeSession(session.id))
                    .catch((err: unknown) => console.error('Failed to kill session', err)),
              },
            ]}
          />
          {isExpanded && renderSessions(projectId, session.id, level + 1)}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="flex flex-col w-[240px] h-full bg-[#09090B] border-r border-[#3F3F46] text-[#FAFAFA] shrink-0">
      {/* Header: new project button */}
      <div className="p-3 border-b border-[#3F3F46]">
        <button
          onClick={() => setIsNewProjectOpen(true)}
          className="flex items-center justify-center w-full gap-2 px-3 py-1.5 text-sm font-medium bg-[#FAFAFA] text-[#09090B] rounded-md hover:bg-[#FAFAFA]/90 transition-colors duration-150 ease-out"
        >
          <Plus size={16} />
          New Project
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {projects.map((project) => {
          const isExpanded = expandedIds.has(project.id);
          const hasChildren = sessions.some(
            (s) => s.projectId === project.id && s.parentSessionId === null,
          );
          const isActive = selectedProjectId === project.id && selectedSessionId === null;

          return (
            <React.Fragment key={project.id}>
              <SidebarItem
                level={0}
                label={project.name}
                isActive={isActive}
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
              {isExpanded && renderSessions(project.id, null, 1)}
            </React.Fragment>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[#3F3F46] flex flex-col gap-2">
        <button className="flex items-center gap-2 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors duration-150 ease-out">
          <Settings size={16} />
          Settings
        </button>
        <StatusBar remoteApiEnabled={remoteApiEnabled} remoteApiPort={remoteApiPort} />
      </div>

      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen} />
    </div>
  );
};
