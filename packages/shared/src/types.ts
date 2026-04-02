import {
  APP_VERSION,
  DEFAULT_OUTPUT_BUFFER_SIZE,
  DEFAULT_REMOTE_API_BIND_ADDRESS,
  DEFAULT_REMOTE_API_PORT,
  DEFAULT_REMOTE_API_START_PORT,
  DEFAULT_THEME,
  HARNESS_NAMES,
  SUPPORTED_AGENT_CLIS,
} from "./constants";

export type UUID = string;
export type ISO8601String = string;
export type Theme = "dark" | "light";
export type SessionType = "plain" | "agent" | "agent_role";
export type SessionState = "starting" | "running" | "exited";
export type AgentCli = (typeof SUPPORTED_AGENT_CLIS)[number];
export type HarnessName = (typeof HARNESS_NAMES)[number];

export interface Project {
  id: UUID;
  name: string;
  directoryPath: string;
  yoloDefault?: boolean;
  createdAt: ISO8601String;
}

export interface AppSettings {
  remoteApiEnabled: boolean;
  remoteApiPort: number | null;
  remoteApiBindAddress: string;
  theme: Theme;
  quickLaunchShortcut: string;
}

export interface RemoteApiCredentials {
  username: string;
  passwordHash: string;
}

export interface RemoteApiCredentialsSummary {
  username: string;
  hasPassword: boolean;
}

export interface RemoteApiCredentialsInput {
  username: string;
  password: string;
}

export interface RemoteApiSessionOptions {
  availableHarnesses: AgentCli[];
  availableAgents: string[];
}

export interface Session {
  id: UUID;
  name: string;
  projectId: UUID;
  parentSessionId: UUID | null;
  type: SessionType;
  cli: AgentCli | null;
  role: string | null;
  yolo: boolean;
  state: SessionState;
  exitCode: number | null;
  outputBuffer: string[];
  mcpEnabled: boolean;
  mcpWrapperId: number | null;
}

export interface SessionRecord extends Session {
  pid: number | null;
}

export interface McpToolBase<Name extends string> {
  name: Name;
  description: string;
  inputSchema: object;
}

export type SpawnSessionTool = McpToolBase<"spawn_session">;

export type SendToSessionTool = McpToolBase<"send_to_session">;

export type ReadSessionTool = McpToolBase<"read_session">;

export type ListSessionsTool = McpToolBase<"list_sessions">;

export type KillSessionTool = McpToolBase<"kill_session">;

export type McpToolSchema =
  | SpawnSessionTool
  | SendToSessionTool
  | ReadSessionTool
  | ListSessionsTool
  | KillSessionTool;

export interface HarnessAdapter {
  enabled: boolean;
  launch_command: string;
  orchestration: string;
  yolo_flag?: string;
  mcp_injection?: "env" | "argv" | "stdio" | "none" | "unknown";
}

export interface AgentPackConfig {
  version: number;
  providers: {
    allowed: string[];
    disallowed: string[];
  };
  models: {
    defaults: {
      low_complexity: {
        provider: string;
        model: string;
      };
      medium_complexity: {
        provider: string;
        model: string;
      };
      high_complexity: {
        provider: string;
        model: string;
      };
    };
    notes: string[];
  };
  harness_adapters: Record<HarnessName | string, HarnessAdapter>;
  mcp: {
    available: string[];
    notes: string[];
  };
  agent_overrides: Record<string, unknown>;
}

export interface SharedDefaults {
  appVersion: typeof APP_VERSION;
  remoteApiBindAddress: typeof DEFAULT_REMOTE_API_BIND_ADDRESS;
  remoteApiPort: typeof DEFAULT_REMOTE_API_PORT;
  theme: typeof DEFAULT_THEME;
  outputBufferSize: typeof DEFAULT_OUTPUT_BUFFER_SIZE;
  remoteApiStartPort: typeof DEFAULT_REMOTE_API_START_PORT;
}

export const SHARED_DEFAULTS: SharedDefaults = {
  appVersion: APP_VERSION,
  remoteApiBindAddress: DEFAULT_REMOTE_API_BIND_ADDRESS,
  remoteApiPort: DEFAULT_REMOTE_API_PORT,
  theme: DEFAULT_THEME,
  outputBufferSize: DEFAULT_OUTPUT_BUFFER_SIZE,
  remoteApiStartPort: DEFAULT_REMOTE_API_START_PORT,
};
