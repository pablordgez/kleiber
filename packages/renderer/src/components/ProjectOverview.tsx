import React, { useEffect, useState } from 'react';
import { Project, Session, UUID } from '@kleiber/shared';
import { Terminal, Play, XCircle, AlertCircle, Circle } from 'lucide-react';
import { cn } from '../lib/utils';

function getSessionDisplayName(session: Session): string {
  return (session as Session & { name?: string }).name ?? session.id.substring(0, 8);
}

export interface ProjectOverviewProps {
  project: Project;
  sessions: Session[];
  onNewSession: () => void;
  onSelectSession: (id: UUID) => void;
  onProjectYoloChange: (nextValue: boolean) => Promise<void>;
}

const getStatusIcon = (state: string): React.ReactNode => {
  switch (state) {
    case 'running':
      return <Play size={14} className="text-[#22C55E]" />;
    case 'exited':
      return <XCircle size={14} className="text-[#EF4444]" />;
    case 'starting':
      return <AlertCircle size={14} className="text-[#F59E0B]" />;
    default:
      return <Circle size={14} className="text-[#A1A1AA]" />;
  }
};

export const ProjectOverview: React.FC<ProjectOverviewProps> = ({
  project,
  sessions,
  onNewSession,
  onSelectSession,
  onProjectYoloChange,
}) => {
  const projectSessions = sessions.filter((s) => s.projectId === project.id);
  const runningSessions = projectSessions.filter((s) => s.state === 'running');
  const [isUpdatingYolo, setIsUpdatingYolo] = useState(false);
  const [yoloError, setYoloError] = useState<string | null>(null);

  useEffect(() => {
    setYoloError(null);
    setIsUpdatingYolo(false);
  }, [project.id, project.yoloDefault]);

  const handleProjectYoloToggle = async () => {
    setIsUpdatingYolo(true);
    setYoloError(null);

    try {
      await onProjectYoloChange(!project.yoloDefault);
    } catch (error) {
      console.error('Failed to update project YOLO default', error);
      setYoloError(error instanceof Error ? error.message : 'Failed to update project YOLO default');
    } finally {
      setIsUpdatingYolo(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#09090B] text-[#FAFAFA] p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{project.name}</h1>
          <p className="text-[#A1A1AA] font-mono text-sm mb-6">{project.directoryPath}</p>

          <div className="flex gap-4 mb-6">
            <div className="bg-[#18181B] border border-[#3F3F46] rounded-lg p-4 flex-1">
              <div className="text-[#A1A1AA] text-sm mb-1">Total Sessions</div>
              <div className="text-2xl font-bold">{projectSessions.length}</div>
            </div>
            <div className="bg-[#18181B] border border-[#3F3F46] rounded-lg p-4 flex-1">
              <div className="text-[#A1A1AA] text-sm mb-1">Running</div>
              <div className="text-2xl font-bold text-[#22C55E]">{runningSessions.length}</div>
            </div>
            <div className="bg-[#18181B] border border-[#3F3F46] rounded-lg p-4 flex-1">
              <div className="text-[#A1A1AA] text-sm mb-1">Project YOLO</div>
              <div className="flex items-center justify-between gap-3">
                <div
                  className={cn(
                    'text-2xl font-bold',
                    project.yoloDefault ? 'text-[#F97316]' : 'text-[#A1A1AA]',
                  )}
                >
                  {project.yoloDefault ? 'Enabled' : 'Disabled'}
                </div>
                <button
                  type="button"
                  onClick={() => void handleProjectYoloToggle()}
                  disabled={isUpdatingYolo}
                  className={cn(
                    'rounded-md border px-3 py-1 text-xs font-medium transition',
                    project.yoloDefault
                      ? 'border-[#F97316]/40 text-[#FDBA74] hover:bg-[#F97316]/10'
                      : 'border-[#3F3F46] text-[#D4D4D8] hover:bg-[#27272A]',
                    isUpdatingYolo && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {isUpdatingYolo ? 'Saving…' : project.yoloDefault ? 'Disable default' : 'Enable default'}
                </button>
              </div>
              <div className="mt-1 text-xs text-[#A1A1AA]">
                New sessions inherit this default unless manually overridden.
              </div>
              {yoloError && <div className="mt-2 text-xs text-[#FCA5A5]">{yoloError}</div>}
            </div>
          </div>

          <button
            onClick={onNewSession}
            className="flex items-center gap-2 bg-[#FAFAFA] text-[#09090B] px-4 py-2 rounded-md font-medium hover:bg-[#FAFAFA]/90 transition-colors duration-150 ease-out"
          >
            <Terminal size={18} />
            New Session
          </button>
        </div>

        <div className="bg-[#18181B] border border-[#3F3F46] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#3F3F46] bg-[#27272A]/50 font-medium text-sm">
            Sessions
          </div>
          {projectSessions.length === 0 ? (
            <div className="p-8 text-center text-[#A1A1AA] text-sm">
              No sessions yet. Create one to get started.
            </div>
          ) : (
            <div className="divide-y divide-[#3F3F46]">
              {projectSessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  className="flex items-center justify-between p-4 hover:bg-[#27272A] cursor-pointer transition-colors duration-150 ease-out"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(session.state)}
                    <span className="font-medium text-sm">{getSessionDisplayName(session)}</span>
                    {session.cli && (
                      <span className="px-2 py-0.5 text-xs bg-[#27272A] border border-[#3F3F46] rounded text-[#A1A1AA]">
                        {session.cli}
                      </span>
                    )}
                    {session.role && (
                      <span className="px-2 py-0.5 text-xs bg-[#27272A] border border-[#3F3F46] rounded text-[#A1A1AA]">
                        {session.role}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-[#A1A1AA]">
                    {session.yolo && (
                      <span className="text-[#F97316] font-bold text-xs border border-[#F97316]/30 px-1.5 py-0.5 rounded">
                        YOLO
                      </span>
                    )}
                    <span className="font-mono text-xs">{session.state}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
