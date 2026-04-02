import React, { useEffect, useState } from "react";
import { ApiClient } from "../api/api";
import type { SessionRecord } from "@kleiber/shared";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";

interface SessionTreeProps {
  projectId: string;
  onSelectSession: (session: SessionRecord) => void;
  onDeleteSession?: (sessionIds: string[]) => void;
  selectedSessionId: string | null;
  onNewSession: () => void;
  refreshToken?: number;
}

export const SessionTree: React.FC<SessionTreeProps> = ({
  projectId,
  onSelectSession,
  onDeleteSession,
  selectedSessionId,
  onNewSession,
  refreshToken = 0,
}) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const loadSessions = async () => {
      try {
        setLoading(true);
        const data = await ApiClient.getSessions(projectId);
        if (mounted) {
          setSessions(data);
          setError("");
        }
      } catch (err: any) {
        if (mounted) setError(err.message || "Failed to load sessions");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadSessions();
    
    // Polling or WebSocket could be added here to update session states
    const interval = setInterval(loadSessions, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectId, refreshToken]);

  const renderSession = (session: SessionRecord, level: number = 0) => {
    const children = sessions.filter(s => s.parentSessionId === session.id);
    const indent = level * 14;
    const handleDelete = async () => {
      const deletedSessionIds = new Set<string>();
      const collectDeletedSessionIds = (currentSessionId: string) => {
        deletedSessionIds.add(currentSessionId);
        sessions
          .filter((candidate) => candidate.parentSessionId === currentSessionId)
          .forEach((candidate) => collectDeletedSessionIds(candidate.id));
      };
      collectDeletedSessionIds(session.id);

      try {
        await ApiClient.deleteSession(projectId, session.id);
        setSessions((current) => current.filter((candidate) => !deletedSessionIds.has(candidate.id)));
        setError("");
        onDeleteSession?.([...deletedSessionIds]);
      } catch (err: any) {
        setError(err.message || "Failed to delete session");
      }
    };

    return (
      <React.Fragment key={session.id}>
        <div
          className={cn(
            "flex items-center gap-2 w-full rounded-lg transition-colors text-[13px]",
            selectedSessionId === session.id
              ? "bg-[#111111] text-[#FFFFFF]"
              : "text-[#999999] hover:bg-[#111111] hover:text-[#FFFFFF]"
          )}
        >
          <button
            onClick={() => onSelectSession(session)}
            className="flex items-center gap-2 flex-1 px-3 py-1.5 text-left"
            style={{ paddingLeft: `${indent + 12}px` }}
          >
            <div className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              session.state === "running" ? "bg-[#22C55E]" :
              session.state === "starting" ? "bg-[#F59E0B]" :
              "bg-[#666666]"
            )} />
            <span className="truncate flex-1">{session.name}</span>
            {session.yolo && (
              <span className="text-[9px] font-semibold text-[#F97316] ml-1.5 px-1 py-px border border-[#F97316]/25 rounded shrink-0 uppercase tracking-wide">
                YOLO
              </span>
            )}
          </button>
          {session.state === "exited" && (
            <button
              onClick={() => {
                void handleDelete();
              }}
              className="mr-2 p-1 rounded-lg text-[#666666] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
              title="Delete session"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {children.map(child => renderSession(child, level + 1))}
      </React.Fragment>
    );
  };

  const rootSessions = sessions.filter(s => !s.parentSessionId);

  return (
    <div className="flex flex-col w-full h-full bg-[#000000] border-r border-[#1C1C1C] overflow-y-auto">
      <div className="px-4 py-3 border-b border-[#1C1C1C] flex items-center justify-between sticky top-0 bg-[#000000]">
        <span className="text-xs font-medium text-[#666666] uppercase tracking-wider">Sessions</span>
        <button
          onClick={onNewSession}
          className="text-[#666666] hover:text-[#FFFFFF] transition-colors p-1 hover:bg-[#111111] rounded-lg"
          title="New Session"
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>
      
      <div className="flex-1 p-2 flex flex-col gap-0.5">
        {loading && sessions.length === 0 ? (
          <div className="p-2 text-center text-sm text-[#666666]">Loading...</div>
        ) : error ? (
          <div className="p-2 text-sm text-[#EF4444]">{error}</div>
        ) : sessions.length === 0 ? (
          <div className="p-2 text-center text-sm text-[#666666]">No sessions</div>
        ) : (
          rootSessions.map(session => renderSession(session))
        )}
      </div>
    </div>
  );
};
