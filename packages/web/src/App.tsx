import React, { useState, useEffect } from "react";
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionName, setSelectedSessionName] = useState<string>("");
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);

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
            onSelectProject={(id) => {
              setSelectedProjectId(id);
              setSelectedSessionId(null);
            }} 
          />
        </div>
        <div className="w-1/2 min-w-[160px]">
          {selectedProjectId ? (
            <SessionTree 
              projectId={selectedProjectId} 
              selectedSessionId={selectedSessionId}
              onSelectSession={(id) => {
                setSelectedSessionId(id);
                // We'd ideally pass the name, but for now we'll just pass ID as fallback
                setSelectedSessionName(`Session ${id.substring(0, 6)}`);
              }}
              onNewSession={() => setIsNewSessionOpen(true)}
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
          onCreated={(id) => {
            setIsNewSessionOpen(false);
            setSelectedSessionId(id);
            setSelectedSessionName("New Session");
          }}
        />
      )}
    </div>
  );
}
