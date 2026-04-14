import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const SESSION_STARTUP_INPUT_QUIET_MS = 4_000;
const SESSION_STARTUP_INPUT_MIN_ELAPSED_MS = 5_000;
const SESSION_STARTUP_INPUT_GRACE_MS = 30_000;
const CODEX_PROGRAMMATIC_ENTER_SEQUENCE = "\u001B[13u";
const PROGRAMMATIC_SUBMIT_DELAY_SHORT_MS = 100;
const PROGRAMMATIC_SUBMIT_DELAY_MEDIUM_MS = 250;
const PROGRAMMATIC_SUBMIT_DELAY_LONG_MS = 750;
const PROGRAMMATIC_SUBMIT_MEDIUM_TEXT_LENGTH = 500;
const PROGRAMMATIC_SUBMIT_LONG_TEXT_LENGTH = 1_000;
const PROGRAMMATIC_PROMPT_CHUNK_THRESHOLD = 512;
const PROGRAMMATIC_PROMPT_CHUNK_SIZE = 128;
const PROGRAMMATIC_PROMPT_CHUNK_DELAY_MS = 20;
const CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_DELAY_MS = 2_000;
const CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_DELAY_PER_EXTRA_KB_MS = 1_000;
const CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_DELAY_MAX_MS = 5_000;
const CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_RETRY_DELAY_MS = 500;
const CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_MAX_WAIT_MS = 8_000;
const CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_MAX_WAIT_PER_EXTRA_KB_MS = 2_000;
const CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_MAX_WAIT_CAP_MS = 20_000;
const CODEX_PROGRAMMATIC_SUBMIT_FORCED_FALLBACK_QUIET_MS = 1_000;
const CODEX_PROGRAMMATIC_SUBMIT_OUTPUT_QUIET_MS = 300;
const CODEX_PROGRAMMATIC_SUBMIT_TAIL_SIGNATURE_LENGTH = 120;

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

export type SessionInputSource = "mcp" | "renderer_ipc" | "remote_ws" | "unknown";

export interface SendSessionInputOptions {
  source?: SessionInputSource;
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
  pendingInputs: Array<{
    input: string;
    source: SessionInputSource;
    delayMs: number;
    delayFromPreviousWrite: boolean;
    notBeforeMs: number | null;
    bypassStartupDeferral: boolean;
  }>;
  pendingInputFlushTimer: NodeJS.Timeout | null;
  pendingCodexProgrammaticSubmit: {
    textLength: number;
    promptTailSignature: string;
    submitWrittenAtMs: number | null;
    firstOutputAfterSubmitAtMs: number | null;
    fallbackSent: boolean;
    fallbackTimer: NodeJS.Timeout | null;
  } | null;
  startedAtMs: number;
  lastOutputAtMs: number | null;
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

  sendToSession(sessionId: UUID, input: string, options: SendSessionInputOptions = {}): void {
    const session = this.#requireSession(sessionId);
    const source = options.source ?? "unknown";

    if (session.state !== "running" || !session.pty) {
      throw new Error(`Session ${sessionId} is not running.`);
    }

    this.#clearPendingCodexProgrammaticSubmit(session);

    const stagedSubmit = resolveProgrammaticSubmit(session, source, input);
    if (stagedSubmit) {
      const submitDelayMs = resolveProgrammaticSubmitDelayMs(stagedSubmit.text.length);
      if (stagedSubmit.armCodexFallback && stagedSubmit.text.length > 0) {
        this.#armPendingCodexProgrammaticSubmit(session, stagedSubmit.text);
      }
      const promptChunks = splitProgrammaticPrompt(stagedSubmit.text);
      if (promptChunks.length > 1) {
        appendRuntimeDebugLog(session, "pty.write.prompt_chunked", {
          cli: session.cli,
          text_length: stagedSubmit.text.length,
          chunk_count: promptChunks.length,
          chunk_size: PROGRAMMATIC_PROMPT_CHUNK_SIZE,
          inter_chunk_delay_ms: PROGRAMMATIC_PROMPT_CHUNK_DELAY_MS,
        });
      }
      for (const [index, chunk] of promptChunks.entries()) {
        this.#enqueueInput(session, chunk, source, {
          ...(index === 0
            ? {}
            : {
                delayMs: PROGRAMMATIC_PROMPT_CHUNK_DELAY_MS,
                delayFromPreviousWrite: true,
                bypassStartupDeferral: true,
              }),
        });
      }
      this.#enqueueInput(session, stagedSubmit.submit, source, {
        delayMs: stagedSubmit.text.length > 0 ? submitDelayMs : 0,
        delayFromPreviousWrite: stagedSubmit.text.length > 0,
        bypassStartupDeferral: stagedSubmit.text.length > 0,
      });
      return;
    }

    this.#enqueueInput(session, input, source);
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

    session.lastOutputAtMs = Date.now();
    const appendedLines = appendOutput(session, chunk);
    if (session.pendingInputs.length > 0) {
      this.#schedulePendingInputFlush(session);
    }
    this.#handleCodexProgrammaticSubmitOutput(session, chunk);
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

  #writeToPty(session: SessionRuntimeRecord, input: string, source: SessionInputSource): void {
    if (session.state !== "running" || !session.pty) {
      throw new Error(`Session ${session.id} is not running.`);
    }

    appendRuntimeDebugLog(session, "pty.write", {
      source,
      length: input.length,
      line_ending: detectDebugLineEnding(input),
      preview: input.slice(0, 200),
    });
    session.pty.write(input);
    this.#handlePostPtyWrite(session, input, source);
  }

  #handlePostPtyWrite(session: SessionRuntimeRecord, input: string, source: SessionInputSource): void {
    if (
      source !== "mcp" ||
      session.cli !== "codex" ||
      input !== CODEX_PROGRAMMATIC_ENTER_SEQUENCE ||
      !session.pendingCodexProgrammaticSubmit ||
      session.pendingCodexProgrammaticSubmit.submitWrittenAtMs !== null
    ) {
      return;
    }

    session.pendingCodexProgrammaticSubmit.submitWrittenAtMs = Date.now();
    const fallbackDelayMs = resolveCodexProgrammaticSubmitFallbackDelayMs(
      session.pendingCodexProgrammaticSubmit.textLength,
    );
    appendRuntimeDebugLog(session, "pty.write.codex_submit_armed", {
      text_length: session.pendingCodexProgrammaticSubmit.textLength,
      fallback_delay_ms: fallbackDelayMs,
      fallback_max_wait_ms: resolveCodexProgrammaticSubmitFallbackMaxWaitMs(
        session.pendingCodexProgrammaticSubmit.textLength,
      ),
    });
    this.#scheduleCodexProgrammaticSubmitFallback(session, fallbackDelayMs);
  }

  #armPendingCodexProgrammaticSubmit(session: SessionRuntimeRecord, text: string): void {
    session.pendingCodexProgrammaticSubmit = {
      textLength: text.length,
      promptTailSignature: buildCodexPromptTailSignature(text),
      submitWrittenAtMs: null,
      firstOutputAfterSubmitAtMs: null,
      fallbackSent: false,
      fallbackTimer: null,
    };
  }

  #clearPendingCodexProgrammaticSubmit(session: SessionRuntimeRecord): void {
    if (session.pendingCodexProgrammaticSubmit?.fallbackTimer) {
      clearTimeout(session.pendingCodexProgrammaticSubmit.fallbackTimer);
    }
    session.pendingCodexProgrammaticSubmit = null;
  }

  #handleCodexProgrammaticSubmitOutput(session: SessionRuntimeRecord, chunk: string): void {
    const pending = session.pendingCodexProgrammaticSubmit;
    if (!pending || pending.submitWrittenAtMs === null) {
      return;
    }

    pending.firstOutputAfterSubmitAtMs ??= Date.now();
    if (codexOutputLooksSubmitted(chunk)) {
      appendRuntimeDebugLog(session, "pty.write.codex_submit_confirmed", {
        text_length: pending.textLength,
        fallback_sent: pending.fallbackSent,
        confirmation: "working_marker",
      });
      this.#clearPendingCodexProgrammaticSubmit(session);
    }
  }

  #scheduleCodexProgrammaticSubmitFallback(session: SessionRuntimeRecord, delayMs: number): void {
    const pending = session.pendingCodexProgrammaticSubmit;
    if (!pending) {
      return;
    }

    if (pending.fallbackTimer) {
      clearTimeout(pending.fallbackTimer);
    }

    pending.fallbackTimer = setTimeout(() => {
      const current = this.#sessions.get(session.id);
      if (!current || current.state !== "running" || !current.pty) {
        return;
      }

      const activePending = current.pendingCodexProgrammaticSubmit;
      if (!activePending || activePending.submitWrittenAtMs === null) {
        return;
      }

      const fallbackDecision = resolveCodexProgrammaticSubmitFallback(current, activePending);
      if (fallbackDecision === "wait") {
        appendRuntimeDebugLog(current, "pty.write.codex_submit_fallback_wait", {
          text_length: activePending.textLength,
          idle_ms_since_submit: Date.now() - activePending.submitWrittenAtMs,
        });
        this.#scheduleCodexProgrammaticSubmitFallback(current, CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_RETRY_DELAY_MS);
        return;
      }

      activePending.fallbackTimer = null;
      activePending.fallbackSent = true;
      appendRuntimeDebugLog(current, "pty.write.codex_submit_fallback", {
        text_length: activePending.textLength,
        idle_ms_since_submit: Date.now() - activePending.submitWrittenAtMs,
        output_seen_since_submit: activePending.firstOutputAfterSubmitAtMs !== null,
      });
      current.pty.write(CODEX_PROGRAMMATIC_ENTER_SEQUENCE);
      appendRuntimeDebugLog(current, "pty.write", {
        source: "mcp",
        length: CODEX_PROGRAMMATIC_ENTER_SEQUENCE.length,
        line_ending: detectDebugLineEnding(CODEX_PROGRAMMATIC_ENTER_SEQUENCE),
        preview: CODEX_PROGRAMMATIC_ENTER_SEQUENCE,
      });
      this.#clearPendingCodexProgrammaticSubmit(current);
    }, delayMs);
  }

  #enqueueInput(
    session: SessionRuntimeRecord,
    input: string,
    source: SessionInputSource,
    options: {
      delayMs?: number;
      delayFromPreviousWrite?: boolean;
      bypassStartupDeferral?: boolean;
    } = {},
  ): void {
    const delayMs = options.delayMs ?? 0;
    const delayFromPreviousWrite = options.delayFromPreviousWrite ?? false;
    const bypassStartupDeferral = options.bypassStartupDeferral ?? false;
    const shouldQueue =
      delayMs > 0 || delayFromPreviousWrite || (!bypassStartupDeferral && this.#shouldDeferInput(session, source));

    if (!shouldQueue) {
      this.#writeToPty(session, input, source);
      return;
    }

    session.pendingInputs.push({
      input,
      source,
      delayMs,
      delayFromPreviousWrite,
      notBeforeMs: delayFromPreviousWrite ? null : Date.now() + delayMs,
      bypassStartupDeferral,
    });
    appendRuntimeDebugLog(session, "pty.write.queued", {
      source,
      queue_length: session.pendingInputs.length,
      length: input.length,
      line_ending: detectDebugLineEnding(input),
      preview: input.slice(0, 200),
      delay_ms: delayMs,
      delay_from_previous_write: delayFromPreviousWrite,
      bypass_startup_deferral: bypassStartupDeferral,
    });
    this.#schedulePendingInputFlush(session);
  }

  #shouldDeferInput(session: SessionRuntimeRecord, source: SessionInputSource): boolean {
    if (source !== "mcp" || !session.cli || session.type === "plain") {
      return false;
    }

    const now = Date.now();
    if (now - session.startedAtMs > SESSION_STARTUP_INPUT_GRACE_MS) {
      return false;
    }

    if (now - session.startedAtMs < SESSION_STARTUP_INPUT_MIN_ELAPSED_MS) {
      return true;
    }

    if (session.lastOutputAtMs === null) {
      return false;
    }

    return now - session.lastOutputAtMs < SESSION_STARTUP_INPUT_QUIET_MS;
  }

  #schedulePendingInputFlush(session: SessionRuntimeRecord): void {
    if (session.pendingInputFlushTimer) {
      clearTimeout(session.pendingInputFlushTimer);
    }

    const nextInput = session.pendingInputs[0];
    if (!nextInput) {
      return;
    }

    const now = Date.now();
    const delay = Math.max(0, this.#resolvePendingInputReadyAt(session, nextInput) - now);
    session.pendingInputFlushTimer = setTimeout(() => {
      session.pendingInputFlushTimer = null;
      this.#flushPendingInputs(session.id);
    }, delay);
  }

  #flushPendingInputs(sessionId: UUID): void {
    const session = this.#sessions.get(sessionId);
    if (!session || session.pendingInputs.length === 0) {
      return;
    }

    if (session.state !== "running" || !session.pty) {
      session.pendingInputs = [];
      return;
    }

    while (session.pendingInputs.length > 0) {
      const nextInput = session.pendingInputs[0];
      if (!nextInput) {
        return;
      }

      if (this.#resolvePendingInputReadyAt(session, nextInput) > Date.now()) {
        this.#schedulePendingInputFlush(session);
        return;
      }

      session.pendingInputs.shift();
      this.#writeToPty(session, nextInput.input, nextInput.source);
    }
  }

  #resolvePendingInputReadyAt(
    session: SessionRuntimeRecord,
    input: SessionRuntimeRecord["pendingInputs"][number],
  ): number {
    if (input.notBeforeMs === null) {
      input.notBeforeMs = Date.now() + input.delayMs;
    }

    let readyAt = input.notBeforeMs;
    if (!input.bypassStartupDeferral && this.#shouldDeferInput(session, input.source)) {
      const lastActivityAt = Math.max(session.startedAtMs, session.lastOutputAtMs ?? 0);
      readyAt = Math.max(
        readyAt,
        lastActivityAt + SESSION_STARTUP_INPUT_QUIET_MS,
        session.startedAtMs + SESSION_STARTUP_INPUT_MIN_ELAPSED_MS,
      );
    }
    return readyAt;
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
    pendingInputs: [],
    pendingInputFlushTimer: null,
    pendingCodexProgrammaticSubmit: null,
    startedAtMs: Date.now(),
    lastOutputAtMs: null,
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

export function resolveEffectiveYolo(
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

  spawnOptions.env = mergeLaunchEnvironments(spawnOptions.env, baseEnv);

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

function mergeLaunchEnvironments(
  existing: NodeJS.ProcessEnv,
  incoming: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = merged[key];
    if (typeof currentValue === "string" && typeof value === "string") {
      const mergedJson = mergeJsonObjectStrings(currentValue, value);
      if (mergedJson) {
        merged[key] = mergedJson;
        continue;
      }
    }

    merged[key] = value;
  }

  return merged;
}

function mergeJsonObjectStrings(existing: string, incoming: string): string | null {
  const existingJson = parseJsonObject(existing);
  const incomingJson = parseJsonObject(incoming);
  if (!existingJson || !incomingJson) {
    return null;
  }

  return JSON.stringify(deepMergeJsonObjects(existingJson, incomingJson));
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function deepMergeJsonObjects(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...left };

  for (const [key, value] of Object.entries(right)) {
    const existingValue = merged[key];
    if (
      existingValue &&
      typeof existingValue === "object" &&
      !Array.isArray(existingValue) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      merged[key] = deepMergeJsonObjects(
        existingValue as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }

    merged[key] = value;
  }

  return merged;
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

function appendRuntimeDebugLog(
  session: Pick<SessionRuntimeRecord, "id" | "workingDirectory">,
  event: string,
  details: Record<string, unknown>,
): void {
  try {
    const logPath = resolveMcpDebugLogPath(session.id, session.workingDirectory);
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`, "utf8");
  } catch {
    // Debug logging must never break terminal I/O.
  }
}

function detectDebugLineEnding(input: string): "none" | "lf" | "crlf" | "cr" {
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

function resolveProgrammaticSubmit(
  session: Pick<SessionRuntimeRecord, "cli">,
  source: SessionInputSource,
  input: string,
): { text: string; submit: string; armCodexFallback: boolean } | null {
  if (source !== "mcp" || !session.cli) {
    return null;
  }

  let text: string | null = null;
  if (input.endsWith("\r\n")) {
    text = input.slice(0, -2);
  } else if (input.endsWith("\r")) {
    text = input.slice(0, -1);
  } else if (input.endsWith("\n")) {
    text = input.slice(0, -1);
  }

  if (text === null) {
    return null;
  }

  const armCodexFallback = session.cli === "codex";
  if (!armCodexFallback && text.length < PROGRAMMATIC_PROMPT_CHUNK_THRESHOLD) {
    return null;
  }

  return {
    text,
    submit: armCodexFallback ? CODEX_PROGRAMMATIC_ENTER_SEQUENCE : "\r",
    armCodexFallback,
  };
}

function splitProgrammaticPrompt(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  if (text.length < PROGRAMMATIC_PROMPT_CHUNK_THRESHOLD) {
    return [text];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += PROGRAMMATIC_PROMPT_CHUNK_SIZE) {
    chunks.push(text.slice(index, index + PROGRAMMATIC_PROMPT_CHUNK_SIZE));
  }
  return chunks;
}

function resolveProgrammaticSubmitDelayMs(textLength: number): number {
  if (textLength >= PROGRAMMATIC_SUBMIT_LONG_TEXT_LENGTH) {
    return PROGRAMMATIC_SUBMIT_DELAY_LONG_MS;
  }

  if (textLength >= PROGRAMMATIC_SUBMIT_MEDIUM_TEXT_LENGTH) {
    return PROGRAMMATIC_SUBMIT_DELAY_MEDIUM_MS;
  }

  return PROGRAMMATIC_SUBMIT_DELAY_SHORT_MS;
}

function resolveCodexProgrammaticSubmitFallbackDelayMs(textLength: number): number {
  const extraPromptKb = Math.max(0, Math.ceil(textLength / 1_000) - 1);
  return Math.min(
    CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_DELAY_MS +
      extraPromptKb * CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_DELAY_PER_EXTRA_KB_MS,
    CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_DELAY_MAX_MS,
  );
}

function resolveCodexProgrammaticSubmitFallbackMaxWaitMs(textLength: number): number {
  const extraPromptKb = Math.max(0, Math.ceil(textLength / 1_000) - 1);
  return Math.min(
    CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_MAX_WAIT_MS +
      extraPromptKb * CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_MAX_WAIT_PER_EXTRA_KB_MS,
    CODEX_PROGRAMMATIC_SUBMIT_FALLBACK_MAX_WAIT_CAP_MS,
  );
}

function resolveCodexProgrammaticSubmitFallback(
  session: Pick<SessionRuntimeRecord, "outputBuffer" | "pendingOutput" | "lastOutputAtMs">,
  pending: NonNullable<SessionRuntimeRecord["pendingCodexProgrammaticSubmit"]>,
): "wait" | "submit" {
  const elapsedSinceSubmitMs =
    pending.submitWrittenAtMs === null ? 0 : Date.now() - pending.submitWrittenAtMs;
  const maxWaitMs = resolveCodexProgrammaticSubmitFallbackMaxWaitMs(pending.textLength);

  if (pending.firstOutputAfterSubmitAtMs === null) {
    return elapsedSinceSubmitMs >= maxWaitMs ? "submit" : "wait";
  }

  if (elapsedSinceSubmitMs >= maxWaitMs) {
    if (
      session.lastOutputAtMs !== null &&
      Date.now() - session.lastOutputAtMs < CODEX_PROGRAMMATIC_SUBMIT_FORCED_FALLBACK_QUIET_MS
    ) {
      return "wait";
    }
    return "submit";
  }

  if (!isCodexPromptTailVisible(session, pending.promptTailSignature)) {
    return "wait";
  }

  if (session.lastOutputAtMs !== null && Date.now() - session.lastOutputAtMs < CODEX_PROGRAMMATIC_SUBMIT_OUTPUT_QUIET_MS) {
    return "wait";
  }

  return "submit";
}

function buildCodexPromptTailSignature(text: string): string {
  return normalizeCodexPromptForMatch(text).slice(-CODEX_PROGRAMMATIC_SUBMIT_TAIL_SIGNATURE_LENGTH);
}

function isCodexPromptTailVisible(
  session: Pick<SessionRuntimeRecord, "outputBuffer" | "pendingOutput">,
  promptTailSignature: string,
): boolean {
  if (!promptTailSignature) {
    return true;
  }

  const visibleOutput = `${session.outputBuffer.toArray().join("\n")}\n${session.pendingOutput}`;
  return normalizeCodexPromptForMatch(visibleOutput).includes(promptTailSignature);
}

function normalizeCodexPromptForMatch(input: string): string {
  return stripAnsi(input).replace(/\s+/g, "").toLowerCase();
}

function codexOutputLooksSubmitted(chunk: string): boolean {
  return normalizeCodexPromptForMatch(chunk).includes("working(");
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
  if (session.pendingInputFlushTimer) {
    clearTimeout(session.pendingInputFlushTimer);
    session.pendingInputFlushTimer = null;
  }

  if (session.pendingCodexProgrammaticSubmit?.fallbackTimer) {
    clearTimeout(session.pendingCodexProgrammaticSubmit.fallbackTimer);
    session.pendingCodexProgrammaticSubmit.fallbackTimer = null;
  }
  session.pendingCodexProgrammaticSubmit = null;

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
