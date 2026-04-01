import type {
  AgentCli,
  AgentPackConfig,
  AppSettings,
  Project,
  RemoteApiCredentials,
  SessionType,
  UUID,
} from "@kleiber/shared";
import type { McpLaunchConfig, ManagedSessionRecord, SessionManagerEvents } from "../sessions/session-manager";

export interface RemoteApiStore {
  listProjects(): Project[];
  getProject(projectId: UUID): Project | undefined;
  getSettings(): AppSettings;
  setSettings(settings: AppSettings): AppSettings;
  getRemoteApiCredentials(): RemoteApiCredentials | null;
}

export interface RemoteApiPackManager {
  readProjectConfig(projectRoot?: string): Promise<AgentPackConfig | null>;
}

export interface RemoteApiSessionManager {
  createSession(options: {
    projectId: string;
    parentSessionId: string | null;
    type: SessionType;
    cli: AgentCli | null;
    role: string | null;
    requestedYolo?: boolean;
    defaultYolo: boolean;
    name: string;
    workingDirectory: string;
    launch?: {
      command: string;
      args: string[];
      env: NodeJS.ProcessEnv;
    };
    mcpEnabled?: boolean;
    mcpLaunchConfig?: McpLaunchConfig | null;
  }): Promise<ManagedSessionRecord>;
  getSession(sessionId: UUID): ManagedSessionRecord | undefined;
  listSessions(projectId?: UUID): ManagedSessionRecord[];
  readSession(sessionId: UUID, options?: { limit?: number; plainText?: boolean }): string[];
  sendToSession(sessionId: UUID, input: string): void;
  on<Event extends keyof SessionManagerEvents>(
    eventName: Event,
    listener: (payload: SessionManagerEvents[Event]) => void,
  ): this;
  removeListener<Event extends keyof SessionManagerEvents>(
    eventName: Event,
    listener: (payload: SessionManagerEvents[Event]) => void,
  ): this;
}

export interface RemoteApiCreateSessionPayload {
  projectId: string;
  parentSessionId?: string | null;
  name: string;
  type?: string;
  cli?: string;
  role?: string;
  yolo?: boolean;
  workingDirectory?: string;
  mcpEnabled?: boolean;
}

export interface RemoteApiCreateSessionResolver {
  (
    payload: RemoteApiCreateSessionPayload,
    options: {
      storeInstance: Pick<RemoteApiStore, "getProject">;
      packManager: Pick<RemoteApiPackManager, "readProjectConfig">;
      mcpRuntime?: {
        wrapperCommand: string;
        wrapperArgs: string[];
      };
    },
  ): Promise<{
    project: Project;
    createSessionInput: {
      projectId: string;
      parentSessionId: string | null;
      type: SessionType;
      cli: AgentCli | null;
      role: string | null;
      requestedYolo?: boolean;
      defaultYolo: boolean;
      name: string;
      workingDirectory: string;
      launch?: {
        command: string;
        args: string[];
        env: NodeJS.ProcessEnv;
      };
      mcpEnabled?: boolean;
      mcpLaunchConfig?: McpLaunchConfig | null;
    };
  }>;
}
