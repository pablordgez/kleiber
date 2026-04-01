import React, { useEffect, useState } from "react";
import { ApiClient } from "../api/api";
import type { SessionRecord } from "@kleiber/shared";
import { Terminal, Plus } from "lucide-react";
import { cn } from "../lib/utils";

interface SessionTreeProps {
  projectId: string;
  onSelectSession: (sessionId: string) => void;
  selectedSessionId: string | null;
  onNewSession: () => void;
}

export const SessionTree: React.FC<SessionTreeProps> = ({ projectId, onSelectSession, selectedSessionId, onNewSession }) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const loadSessions = async () => {
      try {
        setLoading(true);
        const data = await ApiClient.getSessions(projectId);
        if (mounted) setSessions(data);
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
  }, [projectId]);

  const renderSession = (session: SessionRecord, level: number = 0) => {
    const children = sessions.filter(s => s.parentSessionId === session.id);
    const indent = level * 14;

    return (
      <React.Fragment key={session.id}>
        <button
          onClick={() => onSelectSession(session.id)}
          className={cn(
            "flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-left transition-colors text-[13px]",
            selectedSessionId === session.id
              ? "bg-[#111111] text-[#FFFFFF]"
              : "text-[#999999] hover:bg-[#111111] hover:text-[#FFFFFF]"
          )}
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
