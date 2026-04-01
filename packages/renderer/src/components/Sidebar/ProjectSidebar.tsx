import React, { useState } from 'react';
import { Plus, Settings } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { SidebarItem } from './SidebarItem';
import { Session, UUID } from '@kleiber/shared';
import { StatusBar } from '../StatusBar';
import { NewProjectDialog } from '../Dialogs/NewProjectDialog';

function getSessionDisplayName(session: Session): string {
  return (session as Session & { name?: string }).name ?? session.id.substring(0, 8);
}

export interface ProjectSidebarProps {
  remoteApiEnabled: boolean;
  remoteApiPort: number | null;
  onNewSession?: (projectId: UUID, parentSessionId?: UUID) => void;
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
    updateProject,
    removeProject,
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
            label={getSessionDisplayName(session)}
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
          {isExpanded && renderSessions(projectId, session.id, level + 1)}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="flex flex-col w-[220px] h-full bg-[#000000] border-r border-[#1C1C1C] text-[#FFFFFF] shrink-0">
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
              {isExpanded && renderSessions(project.id, null, 1)}
            </React.Fragment>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-3 flex flex-col gap-2">
        <button className="flex items-center gap-2 text-sm text-[#666666] hover:text-[#FFFFFF] transition-colors">
          <Settings size={15} />
          Settings
        </button>
        <StatusBar remoteApiEnabled={remoteApiEnabled} remoteApiPort={remoteApiPort} />
      </div>

      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen} />
    </div>
  );
};
