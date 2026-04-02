import React, { useState, useEffect } from "react";
import type { Project, SessionRecord } from "@kleiber/shared";
import { AuthScreen } from "./components/AuthScreen";
import { ProjectList } from "./components/ProjectList";
import { SessionTree } from "./components/SessionTree";
import { TerminalView } from "./components/TerminalView";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { ApiClient } from "./api/api";
import "./styles.css";

export function App(): JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return !!sessionStorage.getItem("kleiber_token");
  });
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionName, setSelectedSessionName] = useState<string>("");
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [sessionRefreshToken, setSessionRefreshToken] = useState(0);

  const refreshSessions = () => {
    setSessionRefreshToken((current) => current + 1);
  };

  const handleSelectSession = (session: SessionRecord) => {
    setSelectedSessionId(session.id);
    setSelectedSessionName(session.name);
  };

  useEffect(() => {
    const handleAuthError = () => setIsAuthenticated(false);
    window.addEventListener("auth_error", handleAuthError);
    return () => window.removeEventListener("auth_error", handleAuthError);
  }, []);

  if (!isAuthenticated) {
    return <AuthScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#000000] text-[#FFFFFF] font-sans flex-col md:flex-row">
      <div className="flex w-full md:w-[480px] shrink-0 border-b md:border-b-0 md:border-r border-[#1C1C1C]">
        <div className="w-1/2 min-w-[160px] border-r border-[#1C1C1C]">
          <ProjectList 
            selectedProjectId={selectedProjectId} 
            onSelectProject={(project) => {
              setSelectedProject(project);
              setSelectedProjectId(project.id);
              setSelectedSessionId(null);
              setSelectedSessionName("");
            }} 
          />
        </div>
        <div className="w-1/2 min-w-[160px]">
          {selectedProjectId ? (
            <SessionTree 
              projectId={selectedProjectId} 
              selectedSessionId={selectedSessionId}
              onSelectSession={handleSelectSession}
              onDeleteSession={(sessionIds) => {
                if (selectedSessionId && sessionIds.includes(selectedSessionId)) {
                  setSelectedSessionId(null);
                  setSelectedSessionName("");
                }
                refreshSessions();
              }}
              onNewSession={() => setIsNewSessionOpen(true)}
              refreshToken={sessionRefreshToken}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-[#666666]">
              Select a project to view sessions
            </div>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-hidden relative">
        {selectedProjectId && selectedSessionId ? (
          <TerminalView 
            projectId={selectedProjectId} 
            sessionId={selectedSessionId} 
            sessionName={selectedSessionName} 
            onKilled={refreshSessions}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[#666666]">
            Select a session to view terminal
          </div>
        )}
      </div>

      {selectedProjectId && (
        <NewSessionDialog 
          projectId={selectedProjectId}
          isOpen={isNewSessionOpen}
          onClose={() => setIsNewSessionOpen(false)}
          onCreated={(session) => {
            setIsNewSessionOpen(false);
            setSelectedSessionId(session.id);
            setSelectedSessionName(session.name);
            refreshSessions();
          }}
        />
      )}
    </div>
  );
}
