import path from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";

import {
  SUPPORTED_AGENT_CLIS,
  type AgentCli,
  type AgentPackConfig,
  type ISO8601String,
  type Project,
  type SessionState,
  type UUID,
} from "@kleiber/shared";

import type { AgentPackManager } from "../pack/agent-pack-manager";
import { mergeAgentPackConfig } from "../pack/agent-pack-config";
import { resolveAgentOverride, resolveMcpLaunchConfig, type McpRuntimeOptions } from "../pack/mcp-launch-config";
import { resolveHarnessAdapter } from "../pack/harness-adapter";
import {
  appendModelLaunchArgs,
  appendRoleLaunchArgs,
  resolveModelLaunchEnv,
  resolveRoleBootstrap,
} from "../pack/session-launch-config";
import type {
  CreateSessionOptions,
  ManagedSessionRecord,
  SessionManager,
  SessionManagerEvents,
} from "../sessions/session-manager";
import { resolveEffectiveYolo } from "../sessions/session-manager";
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
  > &
    Partial<Pick<SessionManager, "on">>;
  store: Pick<StoreLike, "getProject">;
  packManager: Pick<AgentPackManager, "discoverBundledRoles" | "readProjectConfig">;
  defaultPackConfig: AgentPackConfig;
  mcpRuntime?: McpRuntimeOptions;
  now?: () => number;
  maxSessionsPerProject?: number;
  maxSessionDepth?: number;
  maxSpawnRequestsPerMinute?: number;
}

interface StoreLike {
  getProject(projectId: UUID): Project | undefined;
}

interface SpawnSessionArguments {
  project_id?: UUID;
  cli: AgentCli;
  role?: string;
  model?: string;
  name?: string;
  yolo?: boolean;
  working_dir?: string;
}

interface SendToSessionArguments {
  session_id: UUID;
  text: string;
  submit?: boolean;
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

interface WaitForChildNotificationArguments {
  child_session_id?: UUID;
  timeout_ms?: number;
}

type ParentNotificationKind = "child_message" | "child_exited";

interface ParentNotification {
  kind: ParentNotificationKind;
  child_session_id: UUID;
  child_session_name: string;
  delivered_at: ISO8601String;
  message?: string;
  exit_code?: number | null;
  signal?: number | string | null;
}

interface PendingNotificationWaiter {
  childSessionId: UUID | null;
  resolve: (value: { notification: ParentNotification; timed_out: false }) => void;
  timeout: NodeJS.Timeout | null;
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
  readonly #mcpRuntime: McpRuntimeOptions | undefined;
  readonly #now: () => number;
  readonly #maxSessionsPerProject: number;
  readonly #maxSessionDepth: number;
  readonly #maxSpawnRequestsPerMinute: number;
  readonly #spawnRateWindowBySession = new Map<UUID, number[]>();
  readonly #notificationsByParentSession = new Map<UUID, ParentNotification[]>();
  readonly #pendingNotificationWaitersByParentSession = new Map<UUID, PendingNotificationWaiter[]>();

  constructor(options: McpOrchestratorOptions) {
    this.#sessionManager = options.sessionManager;
    this.#store = options.store;
    this.#packManager = options.packManager;
    this.#defaultPackConfig = options.defaultPackConfig;
    this.#mcpRuntime = options.mcpRuntime;
    this.#now = options.now ?? (() => Date.now());
    this.#maxSessionsPerProject = options.maxSessionsPerProject ?? 50;
    this.#maxSessionDepth = options.maxSessionDepth ?? 10;
    this.#maxSpawnRequestsPerMinute = options.maxSpawnRequestsPerMinute ?? 5;
    this.#sessionManager.on?.("session-exited", (payload) => {
      this.#handleSessionExited(payload);
    });
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
      case "list_available_roles":
        return this.#listAvailableRoles();
      case "notify_parent":
        return this.#notifyParent(
          this.#validateArguments<{ text: string }>("notify_parent", request.arguments),
          callerSession,
        );
      case "wait_for_child_notification":
        return this.#waitForChildNotification(
          this.#validateArguments<WaitForChildNotificationArguments>(
            "wait_for_child_notification",
            request.arguments ?? {},
          ),
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
    if (args.project_id && args.project_id !== callerSession.projectId) {
      throw new Error(
        `spawn_session can only target the calling session's project (${callerSession.projectId}). Omit project_id to use the current project automatically.`,
      );
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
    const packConfig = mergeAgentPackConfig(
      this.#defaultPackConfig,
      await this.#packManager.readProjectConfig(project.directoryPath),
    );
    const adapter = resolveHarnessAdapter(packConfig, cli);
    if (!adapter.enabled) {
      throw new Error(`CLI "${cli}" is disabled in agent_pack_config.yaml.`);
    }
    const override = resolveAgentOverride(packConfig, adapter.harnessName);

    const role = args.role?.trim() ? args.role.trim() : null;
    if (role) {
      const roles = await this.#packManager.discoverBundledRoles();
      if (!roles.includes(role)) {
        throw new Error(`Unknown kleiber-agents role: ${role}`);
      }
    }

    const workingDirectory = resolveWorkingDirectory(project.directoryPath, args.working_dir);
    const launchArgs: string[] = [];
    const launchEnv: NodeJS.ProcessEnv = {
      ...(role ? { KLEIBER_AGENT_ROLE: role } : {}),
    };
    const effectiveYolo = resolveEffectiveYolo(callerSession.yolo, args.yolo, false);
    const mcpLaunchConfig = resolveMcpLaunchConfig(adapter.mcpInjection, override, this.#mcpRuntime);
    const model = args.model?.trim() ? args.model.trim() : null;
    let launchPrompt: string | undefined;
    const sessionInput: CreateSessionOptions = {
      projectId: project.id,
      parentSessionId: callerSession.id,
      cli,
      role,
      ...(args.name?.trim() ? { name: args.name.trim() } : {}),
      workingDirectory,
      ...(args.yolo !== undefined ? { requestedYolo: args.yolo } : {}),
      defaultYolo: false,
      mcpEnabled: Boolean(mcpLaunchConfig),
      mcpLaunchConfig,
      launch: {
        command: adapter.launchCommand,
        args: launchArgs,
        env: launchEnv,
      },
    };

    if (role) {
      const usedRoleActivation = appendRoleLaunchArgs(launchArgs, override, role);
      if (!usedRoleActivation) {
        const bootstrap = await resolveRoleBootstrap(role, cli, Boolean(mcpLaunchConfig));
        launchArgs.push(...bootstrap.args);
        launchPrompt = bootstrap.prompt;
      }
    }

    if (model) {
      appendModelLaunchArgs(launchArgs, override, model);
      Object.assign(launchEnv, resolveModelLaunchEnv(override, model));
    }

    if (effectiveYolo && adapter.yoloFlag) {
      launchArgs.push(adapter.yoloFlag);
    }

    if (launchPrompt) {
      sessionInput.launch = {
        ...sessionInput.launch,
        prompt: launchPrompt,
      };
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

    const normalizedInput = normalizeSessionInput(args.text, args.submit ?? true);
    appendSessionDebugLog(targetSession, "mcp.send_to_session", {
      submit: args.submit ?? true,
      raw_input: summarizeInputForDebug(args.text),
      normalized_input: summarizeInputForDebug(normalizedInput),
    });
    this.#sessionManager.sendToSession(targetSession.id, normalizedInput, { source: "mcp" });
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

  #listSessions(_args: ListSessionsArguments, projectId: UUID): {
    project_id: UUID;
    sessions: Array<Record<string, unknown>>;
  } {
    return {
      project_id: projectId,
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

  async #listAvailableRoles(): Promise<{ roles: string[] }> {
    const roles = await this.#packManager.discoverBundledRoles();
    return { roles };
  }

  #notifyParent(
    args: { text: string },
    callerSession: ManagedSessionRecord,
  ): { delivered: boolean; parent_session_id: UUID } {
    if (!callerSession.parentSessionId) {
      throw new Error("notify_parent is only available from sub-sessions.");
    }

    const parentSession = this.#requireSessionInProject(callerSession.parentSessionId, callerSession.projectId);
    const notification: ParentNotification = {
      kind: "child_message",
      child_session_id: callerSession.id,
      child_session_name: callerSession.name,
      delivered_at: new Date(this.#now()).toISOString(),
      message: args.text.trim(),
    };
    this.#enqueueParentNotification(parentSession.id, notification);
    return {
      delivered: true,
      parent_session_id: parentSession.id,
    };
  }

  async #waitForChildNotification(
    args: WaitForChildNotificationArguments,
    callerSession: ManagedSessionRecord,
  ): Promise<{ notification: ParentNotification | null; timed_out: boolean }> {
    const childSessionId = args.child_session_id?.trim() ? args.child_session_id.trim() : null;
    if (childSessionId) {
      const childSession = this.#requireSessionInProject(childSessionId, callerSession.projectId);
      if (!this.#isDescendantSession(childSession, callerSession.id)) {
        throw new Error(`Session ${childSessionId} is not a descendant of session ${callerSession.id}.`);
      }
    }

    const queued = this.#takeQueuedNotification(callerSession.id, childSessionId);
    if (queued) {
      return { notification: queued, timed_out: false };
    }

    const timeoutMs = args.timeout_ms ?? 300_000;
    if (timeoutMs === 0) {
      return { notification: null, timed_out: true };
    }

    return new Promise((resolve) => {
      const waiter: PendingNotificationWaiter = {
        childSessionId,
        resolve,
        timeout: null,
      };

      waiter.timeout = setTimeout(() => {
        this.#removeNotificationWaiter(callerSession.id, waiter);
        resolve({ notification: null, timed_out: true });
      }, timeoutMs);

      const existing = this.#pendingNotificationWaitersByParentSession.get(callerSession.id) ?? [];
      existing.push(waiter);
      this.#pendingNotificationWaitersByParentSession.set(callerSession.id, existing);
    });
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

  #handleSessionExited(payload: SessionManagerEvents["session-exited"]): void {
    const { session } = payload;
    if (!session.parentSessionId) {
      return;
    }

    const notification: ParentNotification = {
      kind: "child_exited",
      child_session_id: session.id,
      child_session_name: session.name,
      delivered_at: new Date(this.#now()).toISOString(),
      exit_code: session.exitCode,
      signal: session.signal,
    };
    this.#enqueueParentNotification(session.parentSessionId, notification);
  }

  #enqueueParentNotification(parentSessionId: UUID, notification: ParentNotification): void {
    const waiters = this.#pendingNotificationWaitersByParentSession.get(parentSessionId);
    if (waiters && waiters.length > 0) {
      const waiterIndex = waiters.findIndex(
        (candidate) =>
          candidate.childSessionId === null || candidate.childSessionId === notification.child_session_id,
      );
      if (waiterIndex >= 0) {
        const [waiter] = waiters.splice(waiterIndex, 1);
        if (waiters.length === 0) {
          this.#pendingNotificationWaitersByParentSession.delete(parentSessionId);
        }
        waiter?.timeout && clearTimeout(waiter.timeout);
        waiter?.resolve({ notification, timed_out: false });
        return;
      }
    }

    const queued = this.#notificationsByParentSession.get(parentSessionId) ?? [];
    queued.push(notification);
    this.#notificationsByParentSession.set(parentSessionId, queued);
  }

  #takeQueuedNotification(parentSessionId: UUID, childSessionId: UUID | null): ParentNotification | null {
    const queued = this.#notificationsByParentSession.get(parentSessionId);
    if (!queued || queued.length === 0) {
      return null;
    }

    const notificationIndex =
      childSessionId === null
        ? 0
        : queued.findIndex((candidate) => candidate.child_session_id === childSessionId);
    if (notificationIndex < 0) {
      return null;
    }

    const [notification] = queued.splice(notificationIndex, 1);
    if (queued.length === 0) {
      this.#notificationsByParentSession.delete(parentSessionId);
    }

    return notification ?? null;
  }

  #removeNotificationWaiter(parentSessionId: UUID, waiter: PendingNotificationWaiter): void {
    const waiters = this.#pendingNotificationWaitersByParentSession.get(parentSessionId);
    if (!waiters) {
      return;
    }

    const next = waiters.filter((candidate) => candidate !== waiter);
    if (next.length === 0) {
      this.#pendingNotificationWaitersByParentSession.delete(parentSessionId);
      return;
    }

    this.#pendingNotificationWaitersByParentSession.set(parentSessionId, next);
  }

  #isDescendantSession(session: ManagedSessionRecord, ancestorSessionId: UUID): boolean {
    let cursor: ManagedSessionRecord | undefined = session;
    while (cursor) {
      if (cursor.parentSessionId === ancestorSessionId) {
        return true;
      }
      cursor = cursor.parentSessionId ? this.#sessionManager.getSession(cursor.parentSessionId) : undefined;
    }
    return false;
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

function normalizeSessionInput(text: string, submit: boolean): string {
  if (!submit) {
    return text;
  }

  if (text.endsWith("\r")) {
    return text;
  }

  if (text.endsWith("\r\n")) {
    return `${text.slice(0, -2)}\r`;
  }

  if (text.endsWith("\n")) {
    return `${text.slice(0, -1)}\r`;
  }

  return `${text}\r`;
}

function appendSessionDebugLog(
  session: Pick<ManagedSessionRecord, "id" | "workingDirectory">,
  event: string,
  details: Record<string, unknown>,
): void {
  try {
    const logPath = path.join(session.workingDirectory, ".kleiber", "logs", "mcp", `${session.id}.log`);
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`, "utf8");
  } catch {
    // Debug logging must not break session control.
  }
}

function summarizeInputForDebug(input: string): Record<string, unknown> {
  return {
    length: input.length,
    line_ending: detectLineEnding(input),
    preview: input.slice(0, 200),
  };
}

function detectLineEnding(input: string): "none" | "lf" | "crlf" | "cr" {
  if (input.endsWith("\r\n")) {
    return "crlf";
  }
  if (input.endsWith("\n")) {
    return "lf";
  }
  if (input.endsWith("\r")) {
    return "cr";
  }
  return "none";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
