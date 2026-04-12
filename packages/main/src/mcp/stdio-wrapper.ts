import { appendFileSync, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { stdin, stdout } from "node:process";

import { MCP_TOOL_DEFINITIONS, MCP_PROTOCOL_VERSION, type JsonSchema } from "./schemas";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;
type RpcMethod = "initialize" | "tools/list" | "tools/call";

interface WrapperContext {
  sessionId: string;
  projectId: string;
}

export interface WrapperToParentRequest {
  kind: "kleiber.mcp.request";
  requestId: string;
  method: RpcMethod;
  params: unknown;
  context: WrapperContext;
}

export interface ParentToWrapperResponse {
  kind: "kleiber.mcp.response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface ParentBridge {
  send: (message: WrapperToParentRequest) => boolean | void;
  onMessage: (listener: (message: unknown) => void) => () => void;
  onError: (listener: (error: Error) => void) => () => void;
}

interface WrapperStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export interface McpStdioWrapperOptions {
  bridge?: ParentBridge;
  streams?: WrapperStreams;
  context?: Partial<WrapperContext>;
  requestTimeoutMs?: number;
}

interface PendingParentRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

type StdioTransportMode = "frame" | "jsonl";
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const JSON_RPC_VERSION = "2.0";
const DEFAULT_REQUEST_TIMEOUT_MS = resolveDefaultRequestTimeoutMs();

class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function resolveDefaultRequestTimeoutMs(): number {
  const rawValue = process.env.KLEIBER_MCP_REQUEST_TIMEOUT_MS;
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveContext(context?: Partial<WrapperContext>): WrapperContext {
  const sessionId =
    context?.sessionId ??
    process.env.KLEIBER_SESSION_ID ??
    process.env.KLEIBER_MCP_SESSION_ID ??
    "unknown-session";
  const projectId =
    context?.projectId ??
    process.env.KLEIBER_PROJECT_ID ??
    process.env.KLEIBER_MCP_PROJECT_ID ??
    "unknown-project";
  return { sessionId, projectId };
}

function createProcessBridge(): ParentBridge {
  return {
    send: (message) => {
      if (typeof process.send !== "function") {
        return false;
      }
      return process.send(message);
    },
    onMessage: (listener) => {
      const wrapped = (message: unknown): void => {
        listener(message);
      };
      process.on("message", wrapped);
      return () => {
        process.off("message", wrapped);
      };
    },
    onError: () => () => {},
  };
}

function createSocketBridge(socketPath: string): ParentBridge {
  const socket = net.createConnection(socketPath);
  const listeners = new Set<(message: unknown) => void>();
  const errorListeners = new Set<(error: Error) => void>();
  const queue: string[] = [];
  let connected = false;
  let lastError: Error | null = null;
  let buffer = "";

  const emitError = (error: Error): void => {
    lastError = error;
    for (const listener of errorListeners) {
      listener(error);
    }
  };

  socket.setEncoding("utf8");
  socket.setNoDelay(true);
  socket.setTimeout(5_000);
  socket.on("connect", () => {
    connected = true;
    socket.setTimeout(0);
    for (const payload of queue.splice(0)) {
      socket.write(payload);
    }
  });
  socket.on("timeout", () => {
    socket.destroy(new Error(`Timed out connecting to Kleiber MCP socket at ${socketPath}`));
  });
  socket.on("data", (chunk) => {
    buffer += String(chunk);
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line);
        for (const listener of listeners) {
          listener(message);
        }
      } catch {
        // Ignore malformed socket payloads from the parent bridge.
      }
    }
  });
  socket.on("error", (error) => {
    emitError(error instanceof Error ? error : new Error(String(error)));
  });
  socket.on("close", () => {
    if (!connected && !lastError) {
      emitError(new Error(`Kleiber MCP socket closed before connect: ${socketPath}`));
    }
  });

  return {
    send: (message) => {
      if (lastError) {
        return false;
      }
      const payload = `${JSON.stringify(message)}\n`;
      if (connected) {
        socket.write(payload);
        return true;
      }

      queue.push(payload);
      return true;
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          socket.destroy();
        }
      };
    },
    onError: (listener) => {
      errorListeners.add(listener);
      if (lastError) {
        listener(lastError);
      }
      return () => {
        errorListeners.delete(listener);
      };
    },
  };
}

function createDefaultBridge(): ParentBridge {
  if (typeof process.send === "function") {
    return createProcessBridge();
  }

  const socketPath = process.env.KLEIBER_MCP_SOCKET_PATH;
  if (socketPath) {
    return createSocketBridge(socketPath);
  }

  return {
    send: () => false,
    onMessage: () => () => {},
    onError: () => () => {},
  };
}

export class McpStdioWrapper {
  readonly #bridge: ParentBridge;
  readonly #streams: WrapperStreams;
  readonly #context: WrapperContext;
  readonly #requestTimeoutMs: number;

  #pending = new Map<string, PendingParentRequest>();
  #nextRequestId = 0;
  #stdinBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #started = false;
  #teardownParentListener: (() => void) | null = null;
  #teardownBridgeErrorListener: (() => void) | null = null;
  #orchestratorVersion: unknown;
  #orchestratorCapabilities: unknown;
  #debugLogPath = process.env.KLEIBER_MCP_DEBUG_LOG_PATH ?? null;
  #stdioTransportMode: StdioTransportMode = "frame";

  constructor(options: McpStdioWrapperOptions = {}) {
    this.#bridge = options.bridge ?? createDefaultBridge();
    this.#streams = options.streams ?? { input: stdin, output: stdout };
    this.#context = resolveContext(options.context);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  start(): void {
    if (this.#started) {
      return;
    }

    this.#debug("wrapper.start", this.#context);
    this.#started = true;
    this.#teardownParentListener = this.#bridge.onMessage((message) => {
      this.#handleParentMessage(message);
    });
    this.#teardownBridgeErrorListener =
      this.#bridge.onError?.((error) => {
        this.#debug("bridge.error", { message: error.message });
        this.#handleBridgeError(error);
      }) ?? null;
    this.#streams.input.on("data", this.#onInputData);
    if ("resume" in this.#streams.input && typeof this.#streams.input.resume === "function") {
      this.#streams.input.resume();
    }
  }

  stop(): void {
    if (!this.#started) {
      return;
    }

    this.#started = false;
    this.#streams.input.off("data", this.#onInputData);
    if ("pause" in this.#streams.input && typeof this.#streams.input.pause === "function") {
      this.#streams.input.pause();
    }
    this.#teardownParentListener?.();
    this.#teardownParentListener = null;
    this.#teardownBridgeErrorListener?.();
    this.#teardownBridgeErrorListener = null;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new RpcError(-32603, "MCP wrapper shutting down."));
    }

    this.#pending.clear();
    this.#stdinBuffer = Buffer.alloc(0);
  }

  readonly #onInputData = (chunk: Buffer | string): void => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.#debug("stdio.chunk.in", {
      bytes: bytes.length,
      preview: bytes.toString("utf8", 0, Math.min(bytes.length, 120)),
    });
    this.#stdinBuffer = Buffer.concat([this.#stdinBuffer, bytes]);

    while (true) {
      const parsed = this.#tryReadMessage(this.#stdinBuffer);
      if (!parsed) {
        return;
      }

      this.#stdinBuffer = parsed.remaining;
      this.#stdioTransportMode = parsed.transport;
      this.#debug("stdio.frame.in", { bytes: parsed.payload.length });
      void this.#handleIncomingFrame(parsed.payload);
    }
  };

  #tryReadMessage(
    buffer: Buffer<ArrayBufferLike>,
  ): { payload: string; remaining: Buffer<ArrayBufferLike>; transport: StdioTransportMode } | null {
    const jsonLineMessage = this.#tryReadJsonLine(buffer);
    if (jsonLineMessage) {
      return jsonLineMessage;
    }

    return this.#tryReadFrame(buffer);
  }

  #tryReadFrame(
    buffer: Buffer<ArrayBufferLike>,
  ): { payload: string; remaining: Buffer<ArrayBufferLike>; transport: StdioTransportMode } | null {
    const { headerEndIndex, separatorLength } = this.#findHeaderBoundary(buffer);
    if (headerEndIndex === -1) {
      return null;
    }

    const headerText = buffer.subarray(0, headerEndIndex).toString("utf8");
    const contentLength = this.#readContentLength(headerText);
    if (contentLength <= -1) {
      this.#writeJsonRpc({
        jsonrpc: JSON_RPC_VERSION,
        id: null,
        error: {
          code: -32700,
          message: "Invalid Content-Length header.",
        },
      });
      return { payload: "", remaining: Buffer.from([]), transport: "frame" };
    }

    const bodyStartIndex = headerEndIndex + separatorLength;
    const bodyEndIndex = bodyStartIndex + contentLength;
    if (buffer.length < bodyEndIndex) {
      return null;
    }

    return {
      payload: buffer.subarray(bodyStartIndex, bodyEndIndex).toString("utf8"),
      remaining: Buffer.from(buffer.subarray(bodyEndIndex)),
      transport: "frame",
    };
  }

  #tryReadJsonLine(
    buffer: Buffer<ArrayBufferLike>,
  ): { payload: string; remaining: Buffer<ArrayBufferLike>; transport: StdioTransportMode } | null {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) {
      return null;
    }

    const line = buffer.subarray(0, newlineIndex).toString("utf8").trim();
    if (!line.startsWith("{") && !line.startsWith("[")) {
      return null;
    }

    try {
      JSON.parse(line);
    } catch {
      return null;
    }

    return {
      payload: line,
      remaining: Buffer.from(buffer.subarray(newlineIndex + 1)),
      transport: "jsonl",
    };
  }

  #findHeaderBoundary(buffer: Buffer<ArrayBufferLike>): {
    headerEndIndex: number;
    separatorLength: number;
  } {
    const crlfBoundary = buffer.indexOf("\r\n\r\n");
    const lfBoundary = buffer.indexOf("\n\n");

    if (crlfBoundary === -1 && lfBoundary === -1) {
      return { headerEndIndex: -1, separatorLength: 0 };
    }

    if (crlfBoundary === -1) {
      return { headerEndIndex: lfBoundary, separatorLength: 2 };
    }

    if (lfBoundary === -1 || crlfBoundary <= lfBoundary) {
      return { headerEndIndex: crlfBoundary, separatorLength: 4 };
    }

    return { headerEndIndex: lfBoundary, separatorLength: 2 };
  }

  #readContentLength(headerText: string): number {
    const lines = headerText.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const [key, ...rest] = line.split(":");
      if (key?.trim().toLowerCase() !== "content-length") {
        continue;
      }

      const value = Number.parseInt(rest.join(":").trim(), 10);
      return Number.isFinite(value) && value >= 0 ? value : -1;
    }

    return -1;
  }

  async #handleIncomingFrame(payload: string): Promise<void> {
    if (!payload) {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(payload);
    } catch {
      this.#sendRpcError(null, new RpcError(-32700, "Invalid JSON payload."));
      return;
    }

    await this.#handleJsonRpcMessage(message);
  }

  async #handleJsonRpcMessage(raw: unknown): Promise<void> {
    if (!isObject(raw)) {
      this.#sendRpcError(null, new RpcError(-32600, "JSON-RPC payload must be an object."));
      return;
    }
    if (raw.jsonrpc !== JSON_RPC_VERSION) {
      this.#sendRpcError(raw.id as JsonRpcId, new RpcError(-32600, "Unsupported JSON-RPC version. Expected 2.0."));
      return;
    }
    if (typeof raw.method !== "string") {
      this.#sendRpcError(raw.id as JsonRpcId, new RpcError(-32600, "JSON-RPC request must include a string method."));
      return;
    }

    const request: JsonRpcRequest = {
      jsonrpc: JSON_RPC_VERSION,
      method: raw.method,
      ...(raw.id !== undefined ? { id: raw.id as JsonRpcId } : {}),
      ...(raw.params !== undefined ? { params: raw.params } : {}),
    };
    if (request.id === undefined) {
      if (request.method === "notifications/initialized") {
        return;
      }
      return;
    }

    try {
      const result = await this.#dispatchRequest(request);
      this.#sendRpcSuccess(request.id ?? null, result);
    } catch (error) {
      const rpcError =
        error instanceof RpcError
          ? error
          : new RpcError(-32603, "Unhandled wrapper error.", {
              cause: error instanceof Error ? error.message : String(error),
            });
      this.#sendRpcError(request.id ?? null, rpcError);
    }
  }

  async #dispatchRequest(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case "initialize": {
        this.#debug("rpc.initialize");
        const payload = await this.#proxyToParent("initialize", request.params ?? {});
        return this.#normalizeInitializeResult(payload);
      }
      case "tools/list": {
        this.#debug("rpc.tools.list");
        const payload = await this.#proxyToParent("tools/list", request.params ?? {});
        return this.#normalizeToolsListResult(payload);
      }
      case "tools/call": {
        if (!isObject(request.params) || typeof request.params.name !== "string") {
          throw new RpcError(-32602, "tools/call params must include a string name.");
        }
        this.#debug("rpc.tools.call", { name: request.params.name });
        const payload = await this.#proxyToParent("tools/call", request.params);
        return this.#normalizeToolCallResult(request.params.name, payload);
      }
      default:
        throw new RpcError(-32601, `Method not found: ${request.method}`);
    }
  }

  #normalizeInitializeResult(payload: unknown): Record<string, unknown> {
    const result: Record<string, unknown> = isObject(payload) ? payload : {};
    const serverInfo: Record<string, unknown> = isObject(result.serverInfo) ? result.serverInfo : {};

    const normalized: Record<string, unknown> = {
      protocolVersion: typeof result.protocolVersion === "string" ? result.protocolVersion : MCP_PROTOCOL_VERSION,
      capabilities: isObject(result.capabilities) ? result.capabilities : { tools: { listChanged: false } },
      serverInfo: {
        name: typeof serverInfo.name === "string" ? serverInfo.name : "kleiber-mcp-wrapper",
        version: typeof serverInfo.version === "string" ? serverInfo.version : "0.0.0",
      },
    };

    this.#orchestratorVersion = result.version ?? serverInfo.version ?? "0.0.0";
    this.#orchestratorCapabilities = normalized.capabilities;

    return normalized;
  }

  #normalizeToolsListResult(payload: unknown): Record<string, unknown> {
    const toolsByName = new Map<string, Record<string, unknown>>();
    if (isObject(payload) && Array.isArray(payload.tools)) {
      for (const candidate of payload.tools) {
        if (!isObject(candidate) || typeof candidate.name !== "string") {
          continue;
        }
        toolsByName.set(candidate.name, candidate);
      }
    }

    const tools = MCP_TOOL_DEFINITIONS.map((tool) => {
      const existing = toolsByName.get(tool.name);
      if (existing) {
        return existing;
      }
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    });

    const normalized: Record<string, unknown> = { tools };
    if (this.#orchestratorVersion !== undefined) {
      normalized.version = this.#orchestratorVersion;
    }
    if (this.#orchestratorCapabilities !== undefined) {
      normalized.capabilities = this.#orchestratorCapabilities;
    }
    return normalized;
  }

  #normalizeToolCallResult(toolName: string, payload: unknown): Record<string, unknown> {
    if (isToolResultEnvelope(payload)) {
      return payload;
    }

    const summary =
      toolName === "spawn_session"
        ? "Session created."
        : toolName === "send_to_session"
          ? "Input sent to session."
          : toolName === "read_session"
            ? "Session output read."
            : toolName === "list_sessions"
              ? "Sessions listed."
              : toolName === "kill_session"
                ? "Session terminated."
                : toolName === "list_available_roles"
                  ? "Available roles listed."
                  : toolName === "notify_parent"
                    ? "Parent notified."
                    : toolName === "wait_for_child_notification"
                      ? "Child notification received."
                : `${toolName} completed.`;

    const normalized: Record<string, unknown> = {
      content: [
        {
          type: "text",
          text: summary,
        },
      ],
      isError: false,
    };

    const structuredContent = toStructuredContent(payload);
    if (structuredContent !== undefined) {
      normalized.structuredContent = structuredContent;
    }

    return normalized;
  }

  #proxyToParent(method: RpcMethod, params: unknown): Promise<unknown> {
    const requestId = `req-${Date.now()}-${this.#nextRequestId}`;
    this.#nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        this.#debug("parent.timeout", { method, requestId });
        reject(new RpcError(-32603, `Timed out waiting for parent response to ${method}.`));
      }, this.#requestTimeoutMs);

      this.#pending.set(requestId, { resolve, reject, timeout });
      try {
        this.#debug("parent.send", { method, requestId });
        const sent = this.#bridge.send({
          kind: "kleiber.mcp.request",
          requestId,
          method,
          params,
          context: this.#context,
        });
        if (sent === false) {
          clearTimeout(timeout);
          this.#pending.delete(requestId);
          this.#debug("parent.send.failed", { method, requestId });
          reject(new RpcError(-32603, "Parent IPC channel is unavailable."));
        }
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(requestId);
        reject(
          new RpcError(-32603, "Failed sending request to parent IPC channel.", {
            cause: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
  }

  #handleParentMessage(message: unknown): void {
    if (!isObject(message) || message.kind !== "kleiber.mcp.response") {
      return;
    }

    if (typeof message.requestId !== "string" || typeof message.ok !== "boolean") {
      return;
    }

    const response = message as unknown as ParentToWrapperResponse;
    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      return;
    }

    this.#debug("parent.response", {
      requestId: response.requestId,
      ok: response.ok,
    });
    clearTimeout(pending.timeout);
    this.#pending.delete(response.requestId);

    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    pending.reject(
      new RpcError(
        typeof response.error?.code === "number" ? response.error.code : -32603,
        typeof response.error?.message === "string" ? response.error.message : "Parent returned an unknown error.",
        response.error?.data,
      ),
    );
  }

  #handleBridgeError(error: Error): void {
    for (const [requestId, pending] of this.#pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new RpcError(-32603, `Kleiber MCP bridge error: ${error.message}`, {
          requestId,
        }),
      );
    }

    this.#pending.clear();
  }

  #sendRpcSuccess(id: JsonRpcId, result: unknown): void {
    this.#writeJsonRpc({
      jsonrpc: JSON_RPC_VERSION,
      id,
      result,
    });
  }

  #sendRpcError(id: JsonRpcId, error: RpcError): void {
    this.#writeJsonRpc({
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: {
        code: error.code,
        message: error.message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
    });
  }

  #writeJsonRpc(message: JsonRpcResponse): void {
    const payload = JSON.stringify(message);
    this.#debug("stdio.frame.out", {
      id: message.id,
      hasError: "error" in message,
      transport: this.#stdioTransportMode,
    });
    if (this.#stdioTransportMode === "jsonl") {
      this.#streams.output.write(`${payload}\n`);
      return;
    }
    this.#streams.output.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  }

  #debug(event: string, details?: unknown): void {
    if (!this.#debugLogPath) {
      return;
    }

    try {
      mkdirSync(path.dirname(this.#debugLogPath), { recursive: true });
      appendFileSync(
        this.#debugLogPath,
        `${new Date().toISOString()} ${event}${details !== undefined ? ` ${JSON.stringify(details)}` : ""}\n`,
        "utf8",
      );
    } catch {
      // Logging must never break the wrapper protocol path.
    }
  }
}

function isToolResultEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    isObject(value) &&
    (Array.isArray(value.content) ||
      "structuredContent" in value ||
      typeof value.isError === "boolean")
  );
}

function toStructuredContent(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => toStructuredContent(item))
      .filter((item): item is JsonValue => item !== undefined);
    return normalizedItems;
  }
  if (isObject(value)) {
    const normalizedEntries = Object.entries(value)
      .map(([key, entry]) => [key, toStructuredContent(entry)] as const)
      .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined);
    return Object.fromEntries(normalizedEntries);
  }
  return {
    value: String(value),
  };
}

export function runMcpStdioWrapper(options: McpStdioWrapperOptions = {}): McpStdioWrapper {
  const wrapper = new McpStdioWrapper(options);
  wrapper.start();
  return wrapper;
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runMcpStdioWrapper();
}
