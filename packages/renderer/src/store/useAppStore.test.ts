import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "./useAppStore";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      projects: [],
      sessions: [],
      selectedProjectId: null,
      selectedSessionId: null,
      expandedIds: new Set(),
    });
  });

  it("deduplicates sessions added with the same id", () => {
    const initialSession = {
      id: "session-1",
      name: "Session 1",
      projectId: "project-1",
      parentSessionId: null,
      type: "plain" as const,
      cli: null,
      role: null,
      yolo: false,
      state: "starting" as const,
      exitCode: null,
      outputBuffer: [],
      mcpEnabled: false,
      mcpWrapperId: null,
    };

    useAppStore.getState().addSession(initialSession);
    useAppStore.getState().addSession({
      ...initialSession,
      name: "Session 1 Updated",
      state: "running",
    });

    const sessions = useAppStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.name).toBe("Session 1 Updated");
    expect(sessions[0]?.state).toBe("running");
  });

  it("keeps the selected project when switching from a session back to overview", () => {
    useAppStore.setState({
      projects: [
        {
          id: "project-1",
          name: "Project 1",
          directoryPath: "/tmp/project-1",
          createdAt: new Date().toISOString(),
        },
      ],
      sessions: [
        {
          id: "session-1",
          name: "Session 1",
          projectId: "project-1",
          parentSessionId: null,
          type: "plain",
          cli: null,
          role: null,
          yolo: false,
          state: "running",
          exitCode: null,
          outputBuffer: [],
          mcpEnabled: false,
          mcpWrapperId: null,
        },
      ],
      selectedProjectId: "project-1",
      selectedSessionId: "session-1",
      expandedIds: new Set(),
    });

    useAppStore.getState().selectSession(null);

    const state = useAppStore.getState();
    expect(state.selectedSessionId).toBeNull();
    expect(state.selectedProjectId).toBe("project-1");
  });
});
