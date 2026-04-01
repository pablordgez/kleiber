import React from 'react';
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
}) => {
  const projectSessions = sessions.filter((s) => s.projectId === project.id);
  const runningSessions = projectSessions.filter((s) => s.state === 'running');

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
              <div className="text-[#A1A1AA] text-sm mb-1">YOLO Default</div>
              <div
                className={cn(
                  'text-2xl font-bold',
                  project.yoloDefault ? 'text-[#F97316]' : 'text-[#A1A1AA]',
                )}
              >
                {project.yoloDefault ? 'Yes' : 'No'}
              </div>
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
