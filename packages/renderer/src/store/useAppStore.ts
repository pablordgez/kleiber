import { create } from 'zustand';
import { Project, Session, UUID } from '@kleiber/shared';

interface AppState {
  projects: Project[];
  sessions: Session[];
  selectedProjectId: UUID | null;
  selectedSessionId: UUID | null;
  expandedIds: Set<UUID>;

  setProjects: (projects: Project[]) => void;
  setSessions: (sessions: Session[]) => void;
  selectProject: (id: UUID | null) => void;
  selectSession: (id: UUID | null) => void;
  toggleExpanded: (id: UUID) => void;
  addProject: (project: Project) => void;
  removeProject: (id: UUID) => void;
  updateProject: (project: Project) => void;
  addSession: (session: Session) => void;
  removeSession: (id: UUID) => void;
  loadProjects: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  sessions: [],
  selectedProjectId: null,
  selectedSessionId: null,
  expandedIds: new Set<UUID>(),

  setProjects: (projects) => set({ projects }),
  setSessions: (sessions) => set({ sessions }),
  selectProject: (id) => set({ selectedProjectId: id, selectedSessionId: null }),
  selectSession: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    set({ selectedSessionId: id, selectedProjectId: session ? session.projectId : null });
  },
  toggleExpanded: (id) =>
    set((state) => {
      const newExpanded = new Set(state.expandedIds);
      if (newExpanded.has(id)) newExpanded.delete(id);
      else newExpanded.add(id);
      return { expandedIds: newExpanded };
    }),
  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),
  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
    })),
  updateProject: (project) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === project.id ? project : p)),
    })),
  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
    })),
  loadProjects: async () => {
    const projects = await window.kleiber.projects.list();
    set({ projects });
  },
}));
