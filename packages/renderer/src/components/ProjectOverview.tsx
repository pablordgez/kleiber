import React from 'react';
import { Project, Session, UUID } from '@kleiber/shared';
import { Terminal, Play, XCircle, AlertCircle, Circle } from 'lucide-react';

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
      return <Play size={13} className="text-[#22C55E]" />;
    case 'exited':
      return <XCircle size={13} className="text-[#EF4444]" />;
    case 'starting':
      return <AlertCircle size={13} className="text-[#F59E0B]" />;
    default:
      return <Circle size={13} className="text-[#666666]" />;
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
    <div className="flex-1 overflow-y-auto bg-[#000000] text-[#FFFFFF] p-10">
      <div className="max-w-2xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold mb-1 tracking-tight">{project.name}</h1>
          <p className="text-[#666666] font-mono text-xs">{project.directoryPath}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="rounded-lg bg-[#0A0A0A] p-4">
            <div className="text-[#666666] text-xs mb-2">Sessions</div>
            <div className="text-xl font-semibold">{projectSessions.length}</div>
          </div>
          <div className="rounded-lg bg-[#0A0A0A] p-4">
            <div className="text-[#666666] text-xs mb-2">Running</div>
            <div className="text-xl font-semibold text-[#22C55E]">{runningSessions.length}</div>
          </div>
        </div>

        <button
          onClick={onNewSession}
          className="flex items-center gap-2 bg-[#FFFFFF] text-[#000000] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#E5E5E5] transition-colors mb-8"
        >
          <Terminal size={15} />
          New Session
        </button>

        <div className="rounded-lg border border-[#1C1C1C] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#1C1C1C] text-xs font-medium text-[#666666] uppercase tracking-wider">
            Sessions
          </div>
          {projectSessions.length === 0 ? (
            <div className="p-10 text-center text-[#666666] text-sm">
              No sessions yet. Create one to get started.
            </div>
          ) : (
            <div className="divide-y divide-[#1C1C1C]">
              {projectSessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  className="flex items-center justify-between px-4 py-3 hover:bg-[#0A0A0A] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(session.state)}
                    <span className="text-sm font-medium">{getSessionDisplayName(session)}</span>
                    {session.cli && (
                      <span className="px-1.5 py-0.5 text-[11px] bg-[#0A0A0A] rounded-lg text-[#666666]">
                        {session.cli}
                      </span>
                    )}
                    {session.role && (
                      <span className="px-1.5 py-0.5 text-[11px] bg-[#0A0A0A] rounded-lg text-[#666666]">
                        {session.role}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-[#666666]">
                    {session.yolo && (
                      <span className="text-[#F97316] font-semibold text-[10px] border border-[#F97316]/25 px-1.5 py-0.5 rounded uppercase tracking-wide">
                        YOLO
                      </span>
                    )}
                    <span className="font-mono text-[11px]">{session.state}</span>
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
