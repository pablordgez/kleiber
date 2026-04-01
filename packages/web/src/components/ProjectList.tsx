import React, { useEffect, useState } from "react";
import { ApiClient } from "../api/api";
import type { Project } from "@kleiber/shared";
import { Folder } from "lucide-react";
import { cn } from "../lib/utils";

interface ProjectListProps {
  onSelectProject: (projectId: string) => void;
  selectedProjectId: string | null;
}

export const ProjectList: React.FC<ProjectListProps> = ({ onSelectProject, selectedProjectId }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const data = await ApiClient.getProjects();
        setProjects(data);
      } catch (err: any) {
        setError(err.message || "Failed to load projects");
      } finally {
        setLoading(false);
      }
    };
    loadProjects();
  }, []);

  if (loading) {
    return <div className="p-4 text-sm text-[#666666]">Loading projects...</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-[#EF4444]">{error}</div>;
  }

  return (
    <div className="flex flex-col w-full h-full bg-[#000000] border-r border-[#1C1C1C] overflow-y-auto">
      <div className="px-4 py-3 border-b border-[#1C1C1C] text-xs font-medium text-[#666666] uppercase tracking-wider sticky top-0 bg-[#000000]">
        Projects
      </div>
      <div className="flex-1 p-2 flex flex-col gap-1">
        {projects.length === 0 ? (
          <div className="p-2 text-center text-sm text-[#666666]">No projects found</div>
        ) : (
          projects.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelectProject(project.id)}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors",
                selectedProjectId === project.id
                  ? "bg-[#111111] text-[#FFFFFF]"
                  : "text-[#999999] hover:bg-[#111111] hover:text-[#FFFFFF]"
              )}
            >
              <Folder size={16} className={selectedProjectId === project.id ? "text-[#FFFFFF]" : "text-[#666666]"} />
              <div className="flex flex-col truncate">
                <span className="text-sm font-medium truncate">{project.name}</span>
                <span className="text-[10px] text-[#666666] truncate font-mono">{project.directoryPath.split('/').pop()}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
