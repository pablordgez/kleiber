import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentCli, SessionRecord, SessionState, SessionType, UUID } from "@kleiber/shared";

import { resolveMcpSocketPath } from "../mcp/socket-transport";
import { CircularBuffer } from "./circular-buffer";

const DEFAULT_OUTPUT_BUFFER_SIZE = 1_000;
const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 30;
const MAX_OUTPUT_LINE_LENGTH = 10_000;
const TRUNCATED_LINE_SUFFIX = " [truncated]";

export interface PtyExitEvent {
  exitCode: number | null;
  signal?: number | string | null;
}

export interface Disposable {
  dispose(): void;
}

export interface PtyProcess {
  readonly pid: number;
  write(input: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: PtyExitEvent) => void): Disposable;
}

export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  columns: number;
  rows: number;
  name?: string;
}

export type PtyFactory = (options: PtySpawnOptions) => Promise<PtyProcess> | PtyProcess;

export interface SessionLaunchOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  name?: string;
  prompt?: string;
}

interface ResolvedSessionLaunchOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  name: string;
  prompt?: string;
}

export interface McpLaunchConfig {
  injectionMethod: "env" | "argv" | "stdio";
  wrapperCommand: string;
  wrapperArgs: string[];
  argsTemplate?: string[];
  envTemplate?: Record<string, string>;
  configContentTemplate?: string;
  configFileName?: string;
}

export interface CreateSessionOptions {
  projectId: UUID;
  parentSessionId?: UUID | null;
  type?: SessionType;
  cli?: AgentCli | null;
  role?: string | null;
  requestedYolo?: boolean;
  defaultYolo?: boolean;
  name?: string;
  workingDirectory: string;
  launch?: SessionLaunchOptions;
  columns?: number;
  rows?: number;
  mcpEnabled?: boolean;
  mcpWrapperId?: number | null;
  mcpLaunchConfig?: McpLaunchConfig | null;
}

export interface ReadSessionOptions {
  limit?: number;
  plainText?: boolean;
}

export interface ResizeSessionOptions {
  columns: number;
  rows: number;
}

export interface SessionManagerOptions {
  outputBufferSize?: number;
  ptyFactory?: PtyFactory;
  ptyFactoryLoader?: () => Promise<PtyFactory>;
  mcpWrapperFactory?: McpWrapperFactory;
}

export interface McpWrapperRuntime {
  pid: number | null;
  dispose(): void | Promise<void>;
}

export type McpWrapperFactory = (context: {
  sessionId: UUID;
  projectId: UUID;
  workingDirectory: string;
}) => Promise<McpWrapperRuntime> | McpWrapperRuntime;

export interface ManagedSessionRecord extends SessionRecord {
  name: string;
  workingDirectory: string;
  childSessionIds: UUID[];
  signal: number | string | null;
}

interface SessionRuntimeRecord extends Omit<ManagedSessionRecord, "outputBuffer" | "childSessionIds"> {
  childSessionIds: Set<UUID>;
  outputBuffer: CircularBuffer<string>;
  pendingOutput: string;
  pty: PtyProcess | null;
  cleanup: Disposable[];
}

interface SessionCreatedEvent {
  session: ManagedSessionRecord;
}

interface SessionUpdatedEvent {
  session: ManagedSessionRecord;
  previousState: SessionState;
}

interface SessionOutputEvent {
  sessionId: UUID;
  projectId: UUID;
  chunk: string;
  appendedLines: string[];
}

interface SessionExitedEvent {
  session: ManagedSessionRecord;
  previousState: SessionState;
}

interface SessionKilledEvent {
  sessionId: UUID;
  killedSessionIds: UUID[];
}

interface SessionDeletedEvent {
  sessionId: UUID;
  projectId: UUID;
  deletedSessionIds: UUID[];
}

export interface SessionManagerEvents {
  "session-created": SessionCreatedEvent;
  "session-updated": SessionUpdatedEvent;
  "session-output": SessionOutputEvent;
  "session-exited": SessionExitedEvent;
  "session-killed": SessionKilledEvent;
  "session-deleted": SessionDeletedEvent;
}

type EventName = keyof SessionManagerEvents;
type DefaultPtyModule = {
  spawn(command: string, args: string[], options: Record<string, unknown>): PtyProcess;
};

const dynamicImport = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

export class SessionManager extends EventEmitter {
  readonly #sessions = new Map<UUID, SessionRuntimeRecord>();
  readonly #outputBufferSize: number;
  readonly #providedPtyFactory: PtyFactory | null;
  readonly #ptyFactoryLoader: () => Promise<PtyFactory>;
  readonly #mcpWrapperFactory: McpWrapperFactory | null;
  #loadedPtyFactoryPromise: Promise<PtyFactory> | null = null;

  constructor(options: SessionManagerOptions = {}) {
    super();
    this.#outputBufferSize = options.outputBufferSize ?? DEFAULT_OUTPUT_BUFFER_SIZE;
    this.#providedPtyFactory = options.ptyFactory ?? null;
    this.#ptyFactoryLoader = options.ptyFactoryLoader ?? loadDefaultPtyFactory;
    this.#mcpWrapperFactory = options.mcpWrapperFactory ?? null;
  }

  on<Event extends EventName>(eventName: Event, listener: (payload: SessionManagerEvents[Event]) => void): this {
    return super.on(eventName, listener);
  }

  once<Event extends EventName>(
    eventName: Event,
    listener: (payload: SessionManagerEvents[Event]) => void,
  ): this {
    return super.once(eventName, listener);
  }

  emit<Event extends EventName>(eventName: Event, payload: SessionManagerEvents[Event]): boolean {
    return super.emit(eventName, payload);
  }

  async createSession(options: CreateSessionOptions): Promise<ManagedSessionRecord> {
    const parentSession = options.parentSessionId ? this.#requireSession(options.parentSessionId) : null;

    if (parentSession && parentSession.projectId !== options.projectId) {
      throw new Error("Parent session must belong to the same project.");
    }

    const sessionId = randomUUID();
    const type = resolveSessionType(options.type, options.cli ?? null, options.role ?? null);
    const effectiveYolo = resolveEffectiveYolo(
      parentSession?.yolo ?? null,
      options.requestedYolo,
      options.defaultYolo,
    );
    const runtime = createRuntimeRecord({
      id: sessionId,
      projectId: options.projectId,
      parentSessionId: parentSession?.id ?? null,
      type,
      cli: options.cli ?? null,
      role: options.role ?? null,
      yolo: effectiveYolo,
      name: resolveSessionName(type, options.name, options.cli ?? null, options.role ?? null),
      workingDirectory: options.workingDirectory,
      state: "starting",
      mcpEnabled: options.mcpEnabled ?? type !== "plain",
      mcpWrapperId: options.mcpWrapperId ?? null,
      outputBufferSize: this.#outputBufferSize,
    });

    this.#sessions.set(runtime.id, runtime);
    parentSession?.childSessionIds.add(runtime.id);
    this.emit("session-created", { session: this.#snapshot(runtime) });

    try {
      const spawnOptions = resolveSpawnOptions(type, options);
      if (runtime.mcpEnabled && type !== "plain") {
        const mcpContext = {
          sessionId: runtime.id,
          projectId: runtime.projectId,
          workingDirectory: options.workingDirectory,
        };
        const mcpConfigCleanup = applyMcpLaunchConfig(
          spawnOptions,
          options.mcpLaunchConfig ?? null,
          mcpContext,
        );
        if (mcpConfigCleanup) {
          runtime.cleanup.push(mcpConfigCleanup);
        }
        const wrapperRuntime = await this.#startMcpWrapper(
          runtime.id,
          runtime.projectId,
          options.workingDirectory,
        );
        if (wrapperRuntime) {
          runtime.mcpWrapperId = wrapperRuntime.pid;
          runtime.cleanup.push({
            dispose: () => {
              void wrapperRuntime.dispose();
            },
          });
        }
      }
      const pty = await this.#getPtyFactory().then((factory) =>
        factory({
          command: spawnOptions.command,
          args:
            spawnOptions.prompt && spawnOptions.prompt.length > 0
              ? [...spawnOptions.args, spawnOptions.prompt]
              : spawnOptions.args,
          cwd: options.workingDirectory,
          env: { ...process.env, ...spawnOptions.env },
          columns: options.columns ?? DEFAULT_COLUMNS,
          rows: options.rows ?? DEFAULT_ROWS,
          name: spawnOptions.name,
        }),
      );

      runtime.pty = pty;
      runtime.pid = pty.pid;
      runtime.cleanup.push(pty.onData((data) => this.#handleOutput(runtime.id, data)));
      runtime.cleanup.push(pty.onExit((event) => this.#handleExit(runtime.id, event)));
      this.#setState(runtime, "running");
      return this.#snapshot(runtime);
    } catch (error) {
      this.#sessions.delete(runtime.id);
      parentSession?.childSessionIds.delete(runtime.id);
      cleanupRuntime(runtime);
      throw error;
    }
  }

  getSession(sessionId: UUID): ManagedSessionRecord | undefined {
    const session = this.#sessions.get(sessionId);
    return session ? this.#snapshot(session) : undefined;
  }

  listSessions(projectId?: UUID): ManagedSessionRecord[] {
    return [...this.#sessions.values()]
      .filter((session) => (projectId ? session.projectId === projectId : true))
      .map((session) => this.#snapshot(session));
  }

  readSession(sessionId: UUID, options: ReadSessionOptions = {}): string[] {
    const session = this.#requireSession(sessionId);
    const lines = session.outputBuffer.last(options.limit ?? this.#outputBufferSize);
    return options.plainText === false ? lines : lines.map(stripAnsi);
  }

  sendToSession(sessionId: UUID, input: string): void {
    const session = this.#requireSession(sessionId);

    if (session.state !== "running" || !session.pty) {
      throw new Error(`Session ${sessionId} is not running.`);
    }

    session.pty.write(input);
  }

  resizeSession(sessionId: UUID, options: ResizeSessionOptions): void {
    const session = this.#requireSession(sessionId);

    if (session.state !== "running" || !session.pty) {
      throw new Error(`Session ${sessionId} is not running.`);
    }

    session.pty.resize(options.columns, options.rows);
  }


  renameSession(sessionId: UUID, name: string): void {
    const session = this.#requireSession(sessionId);
    const previousState = session.state;
    session.name = name;
    this.emit("session-updated", {
      session: this.#snapshot(session),
      previousState,
    });
  }

  killSession(sessionId: UUID): UUID[] {
    this.#requireSession(sessionId);
    const killedSessionIds = this.#cascadeKill(sessionId);
    this.emit("session-killed", { sessionId, killedSessionIds });
    return killedSessionIds;
  }

  deleteSession(sessionId: UUID): UUID[] {
    const session = this.#requireSession(sessionId);
    const deletedSessionIds = this.#cascadeDelete(sessionId);
    this.emit("session-deleted", {
      sessionId,
      projectId: session.projectId,
      deletedSessionIds,
    });
    return deletedSessionIds;
  }

  dispose(): void {
    for (const session of this.#sessions.values()) {
      if (session.state === "running" && session.pty) {
        session.pty.kill();
      }
    }
  }

  #requireSession(sessionId: UUID): SessionRuntimeRecord {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return session;
  }

  async #getPtyFactory(): Promise<PtyFactory> {
    if (this.#providedPtyFactory) {
      return this.#providedPtyFactory;
    }

    this.#loadedPtyFactoryPromise ??= this.#ptyFactoryLoader();
    return this.#loadedPtyFactoryPromise;
  }

  async #startMcpWrapper(
    sessionId: UUID,
    projectId: UUID,
    workingDirectory: string,
  ): Promise<McpWrapperRuntime | null> {
    if (!this.#mcpWrapperFactory) {
      return null;
    }

    return this.#mcpWrapperFactory({
      sessionId,
      projectId,
      workingDirectory,
    });
  }

  #setState(session: SessionRuntimeRecord, nextState: SessionState): void {
    if (session.state === nextState) {
      return;
    }

    const previousState = session.state;
    session.state = nextState;
    this.emit("session-updated", {
      session: this.#snapshot(session),
      previousState,
    });
  }

  #handleOutput(sessionId: UUID, chunk: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return;
    }

    const appendedLines = appendOutput(session, chunk);
    this.emit("session-output", {
      sessionId,
      projectId: session.projectId,
      chunk,
      appendedLines,
    });
  }

  #handleExit(sessionId: UUID, event: PtyExitEvent): void {
    const session = this.#sessions.get(sessionId);
    if (!session || session.state === "exited") {
      return;
    }

    const previousState = session.state;
    flushPendingOutput(session);
    cleanupRuntime(session);
    session.pty = null;
    session.exitCode = event.exitCode;
    session.signal = event.signal ?? null;
    this.#setState(session, "exited");
    this.emit("session-exited", {
      session: this.#snapshot(session),
      previousState,
    });

    for (const childId of session.childSessionIds) {
      this.#cascadeKill(childId);
    }
  }

  #cascadeKill(sessionId: UUID): UUID[] {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return [];
    }

    const killedSessionIds: UUID[] = [];

    for (const childId of [...session.childSessionIds]) {
      for (const killedId of this.#cascadeKill(childId)) {
        killedSessionIds.push(killedId);
      }
    }

    if (session.state === "running" && session.pty) {
      killedSessionIds.push(session.id);
      session.pty.kill();
    }

    return dedupeIds(killedSessionIds);
  }

  #cascadeDelete(sessionId: UUID): UUID[] {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return [];
    }

    if (session.state !== "exited") {
      throw new Error(`Session ${sessionId} must be exited before it can be deleted.`);
    }

    const deletedSessionIds: UUID[] = [];

    for (const childId of [...session.childSessionIds]) {
      for (const deletedId of this.#cascadeDelete(childId)) {
        deletedSessionIds.push(deletedId);
      }
    }

    if (session.parentSessionId) {
      this.#sessions.get(session.parentSessionId)?.childSessionIds.delete(session.id);
    }

    this.#sessions.delete(session.id);
    cleanupRuntime(session);
    deletedSessionIds.push(session.id);
    return dedupeIds(deletedSessionIds);
  }

  #snapshot(session: SessionRuntimeRecord): ManagedSessionRecord {
    return {
      id: session.id,
      name: session.name,
      projectId: session.projectId,
      parentSessionId: session.parentSessionId,
      type: session.type,
      cli: session.cli,
      role: session.role,
      yolo: session.yolo,
      state: session.state,
      exitCode: session.exitCode,
      pid: session.pid,
      outputBuffer: session.outputBuffer.toArray(),
      mcpEnabled: session.mcpEnabled,
      mcpWrapperId: session.mcpWrapperId,
      workingDirectory: session.workingDirectory,
      childSessionIds: [...session.childSessionIds],
      signal: session.signal,
    };
  }
}

function createRuntimeRecord(input: {
  id: UUID;
  name: string;
  projectId: UUID;
  parentSessionId: UUID | null;
  type: SessionType;
  cli: AgentCli | null;
  role: string | null;
  yolo: boolean;
  workingDirectory: string;
  state: SessionState;
  mcpEnabled: boolean;
  mcpWrapperId: number | null;
  outputBufferSize: number;
}): SessionRuntimeRecord {
  return {
    id: input.id,
    name: input.name,
    projectId: input.projectId,
    parentSessionId: input.parentSessionId,
    type: input.type,
    cli: input.cli,
    role: input.role,
    yolo: input.yolo,
    state: input.state,
    exitCode: null,
    pid: null,
    outputBuffer: new CircularBuffer<string>(input.outputBufferSize),
    pendingOutput: "",
    pty: null,
    childSessionIds: new Set<UUID>(),
    cleanup: [],
    workingDirectory: input.workingDirectory,
    mcpEnabled: input.mcpEnabled,
    mcpWrapperId: input.mcpWrapperId,
    signal: null,
  };
}

function resolveSessionType(
  type: SessionType | undefined,
  cli: AgentCli | null,
  role: string | null,
): SessionType {
  if (type) {
    return type;
  }

  if (!cli) {
    return "plain";
  }

  return role ? "agent_role" : "agent";
}

function resolveSessionName(
  type: SessionType,
  name: string | undefined,
  cli: AgentCli | null,
  role: string | null,
): string {
  if (name && name.trim().length > 0) {
    return name.trim();
  }

  if (type === "agent_role" && cli && role) {
    return `${cli}:${role}`;
  }

  if (type === "agent" && cli) {
    return cli;
  }

  return "shell";
}

function resolveEffectiveYolo(
  parentYolo: boolean | null,
  requestedYolo: boolean | undefined,
  defaultYolo: boolean | undefined,
): boolean {
  if (parentYolo === false) {
    return false;
  }

  if (requestedYolo !== undefined) {
    return requestedYolo;
  }

  return defaultYolo ?? false;
}

function resolveSpawnOptions(
  type: SessionType,
  options: CreateSessionOptions,
): ResolvedSessionLaunchOptions {
  if (options.launch?.command) {
    return {
      command: options.launch.command,
      args: options.launch.args ?? [],
      env: options.launch.env ?? {},
      name: options.launch.name ?? defaultPtyName(),
      ...(options.launch.prompt ? { prompt: options.launch.prompt } : {}),
    };
  }

  if (type !== "plain") {
    throw new Error("Agent sessions require an explicit launch command.");
  }

  return {
    command: resolveDefaultShell(),
    args: [],
    env: {},
    name: defaultPtyName(),
  };
}

function applyMcpLaunchConfig(
  spawnOptions: ResolvedSessionLaunchOptions,
  config: McpLaunchConfig | null,
  context: { sessionId: UUID; projectId: UUID; workingDirectory: string },
): Disposable | null {
  const wrapperCommand = config?.wrapperCommand ?? process.execPath;
  const wrapperArgs = config?.wrapperArgs ?? [];
  const mcpConfigPath = config?.configContentTemplate
    ? resolveMcpConfigPath(context.sessionId, config.configFileName)
    : null;

  if (mcpConfigPath && config?.configContentTemplate) {
    mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    writeFileSync(
      mcpConfigPath,
      replaceTemplateValue(
        config.configContentTemplate,
        context,
        wrapperCommand,
        wrapperArgs,
        mcpConfigPath,
      ),
      "utf8",
    );
  }

  const baseEnv: NodeJS.ProcessEnv = {
    KLEIBER_MCP_ENABLED: "true",
    KLEIBER_MCP_TRANSPORT: "stdio",
    KLEIBER_MCP_SESSION_ID: context.sessionId,
    KLEIBER_MCP_PROJECT_ID: context.projectId,
    KLEIBER_MCP_SOCKET_PATH: resolveMcpSocketPath(context.sessionId, context.workingDirectory),
    KLEIBER_MCP_DEBUG_LOG_PATH: resolveMcpDebugLogPath(context.sessionId, context.workingDirectory),
    KLEIBER_MCP_SERVER_COMMAND: wrapperCommand,
    KLEIBER_MCP_SERVER_ARGS_JSON: JSON.stringify(wrapperArgs),
    ...(config?.envTemplate
      ? replaceTemplateValues(
          config.envTemplate,
          context,
          wrapperCommand,
          wrapperArgs,
          mcpConfigPath,
        )
      : {}),
  };

  spawnOptions.env = {
    ...spawnOptions.env,
    ...baseEnv,
  };

  if (config?.injectionMethod === "argv" && config.argsTemplate) {
    spawnOptions.args = [
      ...spawnOptions.args,
      ...config.argsTemplate.map((entry) =>
        replaceTemplateValue(entry, context, wrapperCommand, wrapperArgs, mcpConfigPath),
      ),
    ];
  }

  if (!mcpConfigPath) {
    return null;
  }

  return {
    dispose: () => {
      rmSync(path.dirname(mcpConfigPath), { recursive: true, force: true });
    },
  };
}

function replaceTemplateValues(
  template: Record<string, string>,
  context: { sessionId: UUID; projectId: UUID; workingDirectory: string },
  wrapperCommand: string,
  wrapperArgs: string[],
  mcpConfigPath?: string | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [
      key,
      replaceTemplateValue(value, context, wrapperCommand, wrapperArgs, mcpConfigPath),
    ]),
  );
}

function replaceTemplateValue(
  value: string,
  context: { sessionId: UUID; projectId: UUID; workingDirectory: string },
  wrapperCommand: string,
  wrapperArgs: string[],
  mcpConfigPath?: string | null,
): string {
  const socketPath = resolveMcpSocketPath(context.sessionId, context.workingDirectory);
  const debugLogPath = resolveMcpDebugLogPath(context.sessionId, context.workingDirectory);
  return value
    .replaceAll("{sessionId}", context.sessionId)
    .replaceAll("{projectId}", context.projectId)
    .replaceAll("{mcpSocketPath}", socketPath)
    .replaceAll("{mcpDebugLogPath}", debugLogPath)
    .replaceAll("{mcpDebugLogPathJson}", JSON.stringify(debugLogPath))
    .replaceAll("{wrapperCommand}", wrapperCommand)
    .replaceAll("{wrapperCommandJson}", JSON.stringify(wrapperCommand))
    .replaceAll("{wrapperCommandAndArgsJson}", JSON.stringify([wrapperCommand, ...wrapperArgs]))
    .replaceAll("{wrapperArgsJson}", JSON.stringify(wrapperArgs))
    .replaceAll("{mcpConfigPath}", mcpConfigPath ?? "");
}

function resolveMcpConfigPath(sessionId: UUID, fileName = "mcp-config.json"): string {
  return path.join(os.tmpdir(), "kleiber-mcp", sessionId, fileName);
}

function resolveMcpDebugLogPath(sessionId: UUID, workingDirectory: string): string {
  return path.join(workingDirectory, ".kleiber", "logs", "mcp", `${sessionId}.log`);
}

function resolveDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "cmd.exe";
  }

  return process.env.SHELL ?? "/bin/bash";
}

function defaultPtyName(): string {
  return process.platform === "win32" ? "xterm-color" : "xterm-256color";
}

function appendOutput(session: SessionRuntimeRecord, chunk: string): string[] {
  const normalized = `${session.pendingOutput}${chunk.replace(/\r\n/g, "\n")}`;
  const parts = normalized.split("\n");
  session.pendingOutput = parts.pop() ?? "";

  const appendedLines = parts.map(truncateLine);
  for (const line of appendedLines) {
    session.outputBuffer.push(line);
  }

  return appendedLines;
}

function flushPendingOutput(session: SessionRuntimeRecord): void {
  if (session.pendingOutput.length === 0) {
    return;
  }

  session.outputBuffer.push(truncateLine(session.pendingOutput));
  session.pendingOutput = "";
}

function truncateLine(line: string): string {
  if (line.length <= MAX_OUTPUT_LINE_LENGTH) {
    return line;
  }

  const allowedLength = MAX_OUTPUT_LINE_LENGTH - TRUNCATED_LINE_SUFFIX.length;
  return `${line.slice(0, allowedLength)}${TRUNCATED_LINE_SUFFIX}`;
}

function stripAnsi(line: string): string {
  return line.replace(
    // eslint-disable-next-line no-control-regex
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g,
    "",
  );
}

function cleanupRuntime(session: SessionRuntimeRecord): void {
  for (const disposable of session.cleanup.splice(0)) {
    disposable.dispose();
  }
}

function dedupeIds(ids: UUID[]): UUID[] {
  return [...new Set(ids)];
}

async function loadDefaultPtyFactory(): Promise<PtyFactory> {
  const nodePty = (await dynamicImport("node-pty")) as DefaultPtyModule;

  return (options) =>
    nodePty.spawn(options.command, options.args, {
      name: options.name,
      cwd: options.cwd,
      env: options.env,
      cols: options.columns,
      rows: options.rows,
    });
}
