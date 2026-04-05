import path from "node:path";

import {
  SUPPORTED_AGENT_CLIS,
  type AgentCli,
  type AgentPackConfig,
  type Project,
  type SessionState,
  type UUID,
} from "@kleiber/shared";

import type { AgentPackManager } from "../pack/agent-pack-manager";
import { resolveHarnessAdapter } from "../pack/harness-adapter";
import type { CreateSessionOptions, ManagedSessionRecord, SessionManager } from "../sessions/session-manager";
import { KLEIBER_MCP_SERVER_NAME, KLEIBER_MCP_SERVER_VERSION, MCP_PROTOCOL_VERSION, MCP_TOOL_DEFINITIONS, type JsonSchema, validateJsonSchema } from "./schemas";

export interface McpCallerContext {
  sessionId: UUID;
  projectId: UUID;
}

export interface McpToolCallRequest {
  name: string;
  arguments?: unknown;
}

export interface McpOrchestratorOptions {
  sessionManager: Pick<
    SessionManager,
    "createSession" | "getSession" | "listSessions" | "readSession" | "sendToSession" | "killSession"
  >;
  store: Pick<StoreLike, "getProject">;
  packManager: Pick<AgentPackManager, "discoverBundledRoles" | "readProjectConfig">;
  defaultPackConfig: AgentPackConfig;
  now?: () => number;
  maxSessionsPerProject?: number;
  maxSessionDepth?: number;
  maxSpawnRequestsPerMinute?: number;
}

interface StoreLike {
  getProject(projectId: UUID): Project | undefined;
}

interface SpawnSessionArguments {
  project_id: UUID;
  cli: AgentCli;
  role?: string;
  name?: string;
  yolo?: boolean;
  working_dir?: string;
}

interface SendToSessionArguments {
  session_id: UUID;
  text: string;
}

interface ReadSessionArguments {
  session_id: UUID;
  lines?: number;
  format?: "plain" | "raw";
}

interface ListSessionsArguments {
  project_id?: UUID;
}

interface KillSessionArguments {
  session_id: UUID;
}

const CLI_ALIASES: Readonly<Record<string, AgentCli>> = {
  "claude-code": "claude",
  claude_code: "claude",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
};

export class McpOrchestrator {
  readonly #sessionManager: McpOrchestratorOptions["sessionManager"];
  readonly #store: McpOrchestratorOptions["store"];
  readonly #packManager: McpOrchestratorOptions["packManager"];
  readonly #defaultPackConfig: AgentPackConfig;
  readonly #now: () => number;
  readonly #maxSessionsPerProject: number;
  readonly #maxSessionDepth: number;
  readonly #maxSpawnRequestsPerMinute: number;
  readonly #spawnRateWindowBySession = new Map<UUID, number[]>();

  constructor(options: McpOrchestratorOptions) {
    this.#sessionManager = options.sessionManager;
    this.#store = options.store;
    this.#packManager = options.packManager;
    this.#defaultPackConfig = options.defaultPackConfig;
    this.#now = options.now ?? (() => Date.now());
    this.#maxSessionsPerProject = options.maxSessionsPerProject ?? 50;
    this.#maxSessionDepth = options.maxSessionDepth ?? 10;
    this.#maxSpawnRequestsPerMinute = options.maxSpawnRequestsPerMinute ?? 5;
  }

  initialize(): Record<string, unknown> {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: KLEIBER_MCP_SERVER_NAME,
        version: KLEIBER_MCP_SERVER_VERSION,
      },
      version: KLEIBER_MCP_SERVER_VERSION,
    };
  }

  listTools(): Record<string, unknown> {
    return {
      tools: [...MCP_TOOL_DEFINITIONS],
      version: KLEIBER_MCP_SERVER_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
    };
  }

  async callTool(request: McpToolCallRequest, context: McpCallerContext): Promise<unknown> {
    const callerSession = this.#requireSessionInProject(context.sessionId, context.projectId);

    switch (request.name) {
      case "spawn_session":
        return this.#spawnSession(
          this.#validateArguments<SpawnSessionArguments>("spawn_session", request.arguments),
          callerSession,
        );
      case "send_to_session":
        return this.#sendToSession(
          this.#validateArguments<SendToSessionArguments>("send_to_session", request.arguments),
          context.projectId,
        );
      case "read_session":
        return this.#readSession(
          this.#validateArguments<ReadSessionArguments>("read_session", request.arguments),
          context.projectId,
        );
      case "list_sessions":
        return this.#listSessions(
          this.#validateArguments<ListSessionsArguments>("list_sessions", request.arguments ?? {}),
          context.projectId,
        );
      case "kill_session":
        return this.#killSession(
          this.#validateArguments<KillSessionArguments>("kill_session", request.arguments),
          callerSession,
        );
      default:
        throw new Error(`Unknown MCP tool: ${request.name}`);
    }
  }

  async handleParentRequest(input: {
    method: "initialize" | "tools/list" | "tools/call";
    params: unknown;
    context: McpCallerContext;
  }): Promise<unknown> {
    switch (input.method) {
      case "initialize":
        return this.initialize();
      case "tools/list":
        return this.listTools();
      case "tools/call":
        return this.callTool(this.#normalizeToolCall(input.params), input.context);
      default:
        throw new Error(`Unsupported MCP method: ${input.method}`);
    }
  }

  #normalizeToolCall(value: unknown): McpToolCallRequest {
    if (!isRecord(value) || typeof value.name !== "string") {
      throw new Error("tools/call params must include a tool name.");
    }

    return {
      name: value.name,
      arguments: value.arguments,
    };
  }

  async #spawnSession(args: SpawnSessionArguments, callerSession: ManagedSessionRecord): Promise<unknown> {
    const project = this.#requireProject(callerSession.projectId);
    if (args.project_id !== callerSession.projectId) {
      throw new Error("spawn_session is limited to the calling session's project.");
    }

    this.#enforceSpawnRateLimit(callerSession.id);

    const activeSessions = this.#sessionManager
      .listSessions(project.id)
      .filter((session) => session.state !== "exited");
    if (activeSessions.length >= this.#maxSessionsPerProject) {
      throw new Error(`Project ${project.id} reached the ${String(this.#maxSessionsPerProject)} active session limit.`);
    }

    const currentDepth = this.#measureDepth(callerSession);
    if (currentDepth >= this.#maxSessionDepth) {
      throw new Error(`Sub-session depth limit (${String(this.#maxSessionDepth)}) reached.`);
    }

    const cli = normalizeCli(args.cli);
    const packConfig = (await this.#packManager.readProjectConfig(project.directoryPath)) ?? this.#defaultPackConfig;
    const adapter = resolveHarnessAdapter(packConfig, cli);
    if (!adapter.enabled) {
      throw new Error(`CLI "${cli}" is disabled in agent_pack_config.yaml.`);
    }

    const role = args.role?.trim() ? args.role.trim() : null;
    if (role) {
      const roles = await this.#packManager.discoverBundledRoles();
      if (!roles.includes(role)) {
        throw new Error(`Unknown kleiber-agents role: ${role}`);
      }
    }

    const workingDirectory = resolveWorkingDirectory(project.directoryPath, args.working_dir);
    const launchArgs: string[] = [];
    const sessionInput: CreateSessionOptions = {
      projectId: project.id,
      parentSessionId: callerSession.id,
      cli,
      role,
      ...(args.name?.trim() ? { name: args.name.trim() } : {}),
      workingDirectory,
      ...(args.yolo !== undefined ? { requestedYolo: args.yolo } : {}),
      defaultYolo: false,
      mcpEnabled: false,
      launch: {
        command: adapter.launchCommand,
        args: launchArgs,
        env: role ? { KLEIBER_AGENT_ROLE: role } : {},
      },
    };

    if (role) {
      appendRoleLaunchArgs(launchArgs, packConfig, adapter.harnessName, role);
    }

    const session = await this.#sessionManager.createSession(sessionInput);
    return {
      session_id: session.id,
      name: session.name,
      yolo: session.yolo,
    };
  }

  #sendToSession(args: SendToSessionArguments, projectId: UUID): { success: boolean } {
    const targetSession = this.#requireSessionInProject(args.session_id, projectId);
    if (targetSession.state !== "running") {
      throw new Error(`Session ${targetSession.id} is not running.`);
    }

    this.#sessionManager.sendToSession(targetSession.id, args.text);
    return { success: true };
  }

  #readSession(args: ReadSessionArguments, projectId: UUID): { output: string; line_count: number; format: string } {
    const targetSession = this.#requireSessionInProject(args.session_id, projectId);
    const format = args.format ?? "plain";
    const lines = this.#sessionManager.readSession(targetSession.id, {
      limit: args.lines ?? 100,
      plainText: format === "plain",
    });

    return {
      output: lines.join("\n"),
      line_count: lines.length,
      format,
    };
  }

  #listSessions(_args: ListSessionsArguments, projectId: UUID): { sessions: Array<Record<string, unknown>> } {
    return {
      sessions: this.#sessionManager.listSessions(projectId).map((session) => ({
        session_id: session.id,
        name: session.name,
        cli: session.cli,
        role: session.role,
        state: session.state,
        yolo: session.yolo,
        parent_session_id: session.parentSessionId,
      })),
    };
  }

  #killSession(args: KillSessionArguments, callerSession: ManagedSessionRecord): { success: boolean } {
    const targetSession = this.#requireSessionInProject(args.session_id, callerSession.projectId);
    if (targetSession.id === callerSession.id) {
      throw new Error("A session cannot kill itself.");
    }

    this.#sessionManager.killSession(targetSession.id);
    return { success: true };
  }

  #validateArguments<T>(toolName: string, value: unknown): T {
    const schema = schemaForTool(toolName);
    const result = validateJsonSchema(schema, value);
    if (!result.valid) {
      throw new Error(result.errors.join(" "));
    }

    return value as T;
  }

  #requireProject(projectId: UUID): Project {
    const project = this.#store.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found.`);
    }
    return project;
  }

  #requireSessionInProject(sessionId: UUID, projectId: UUID): ManagedSessionRecord {
    const session = this.#sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    if (session.projectId !== projectId) {
      throw new Error("Cross-project session access is not allowed.");
    }
    return session;
  }

  #measureDepth(session: ManagedSessionRecord): number {
    let depth = 1;
    let cursor = session.parentSessionId ? this.#sessionManager.getSession(session.parentSessionId) : undefined;
    while (cursor) {
      depth += 1;
      cursor = cursor.parentSessionId ? this.#sessionManager.getSession(cursor.parentSessionId) : undefined;
    }
    return depth;
  }

  #enforceSpawnRateLimit(sessionId: UUID): void {
    const now = this.#now();
    const windowStart = now - 60_000;
    const current = (this.#spawnRateWindowBySession.get(sessionId) ?? []).filter((entry) => entry >= windowStart);
    if (current.length >= this.#maxSpawnRequestsPerMinute) {
      this.#spawnRateWindowBySession.set(sessionId, current);
      throw new Error(`spawn_session rate limit exceeded for session ${sessionId}.`);
    }

    current.push(now);
    this.#spawnRateWindowBySession.set(sessionId, current);
  }
}

function schemaForTool(toolName: string): JsonSchema {
  const definition = MCP_TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
  if (!definition) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }

  return definition.inputSchema as unknown as JsonSchema;
}

function normalizeCli(value: string): AgentCli {
  const normalized = value.trim().toLowerCase();
  if ((SUPPORTED_AGENT_CLIS as readonly string[]).includes(normalized)) {
    return normalized as AgentCli;
  }
  const alias = CLI_ALIASES[normalized];
  if (alias) {
    return alias;
  }
  throw new Error(`Unsupported CLI: ${value}`);
}

function resolveWorkingDirectory(projectDirectory: string, requestedWorkingDir: string | undefined): string {
  const baseDirectory = path.resolve(projectDirectory);
  if (!requestedWorkingDir) {
    return baseDirectory;
  }

  if (!path.isAbsolute(requestedWorkingDir)) {
    throw new Error("working_dir must be an absolute path.");
  }

  const resolved = path.resolve(requestedWorkingDir);
  const relative = path.relative(baseDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("working_dir must stay within the project directory.");
  }

  return resolved;
}

function appendRoleLaunchArgs(
  args: string[],
  config: AgentPackConfig,
  harnessName: string,
  role: string,
): void {
  const override = config.agent_overrides[harnessName];
  if (!isRecord(override)) {
    return;
  }

  const roleFlag =
    typeof override.role_flag === "string"
      ? override.role_flag
      : typeof override.roleFlag === "string"
        ? override.roleFlag
        : null;
  if (roleFlag) {
    args.push(roleFlag, role);
    return;
  }

  const roleTemplate =
    Array.isArray(override.role_args_template) && override.role_args_template.every((value) => typeof value === "string")
      ? (override.role_args_template as string[])
      : Array.isArray(override.roleArgsTemplate) && override.roleArgsTemplate.every((value) => typeof value === "string")
        ? (override.roleArgsTemplate as string[])
        : null;
  if (roleTemplate) {
    args.push(...roleTemplate.map((entry) => entry.replaceAll("{role}", role)));
    return;
  }

  if (override.role_as_positional === true || override.roleAsPositional === true) {
    args.push(role);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
