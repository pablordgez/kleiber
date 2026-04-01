import net from "node:net";
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

const JSON_RPC_VERSION = "2.0";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveContext(context?: Partial<WrapperContext>): WrapperContext {
  const sessionId = context?.sessionId ?? process.env.KLEIBER_SESSION_ID ?? "unknown-session";
  const projectId = context?.projectId ?? process.env.KLEIBER_PROJECT_ID ?? "unknown-project";
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
  };
}

function createSocketBridge(socketPath: string): ParentBridge {
  const socket = net.createConnection(socketPath);
  const listeners = new Set<(message: unknown) => void>();
  const queue: string[] = [];
  let connected = false;
  let buffer = "";

  socket.setEncoding("utf8");
  socket.on("connect", () => {
    connected = true;
    for (const payload of queue.splice(0)) {
      socket.write(payload);
    }
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

  return {
    send: (message) => {
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
  };
}

export class McpStdioWrapper {
  readonly #bridge: ParentBridge;
  readonly #streams: WrapperStreams;
  readonly #context: WrapperContext;
  readonly #requestTimeoutMs: number;

  #pending = new Map<string, PendingParentRequest>();
  #nextRequestId = 0;
  #stdinBuffer = Buffer.alloc(0);
  #started = false;
  #teardownParentListener: (() => void) | null = null;
  #orchestratorVersion: unknown;
  #orchestratorCapabilities: unknown;

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

    this.#started = true;
    this.#teardownParentListener = this.#bridge.onMessage((message) => {
      this.#handleParentMessage(message);
    });
    this.#streams.input.on("data", this.#onInputData);
  }

  stop(): void {
    if (!this.#started) {
      return;
    }

    this.#started = false;
    this.#streams.input.off("data", this.#onInputData);
    this.#teardownParentListener?.();
    this.#teardownParentListener = null;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new RpcError(-32603, "MCP wrapper shutting down."));
    }

    this.#pending.clear();
    this.#stdinBuffer = Buffer.alloc(0);
  }

  readonly #onInputData = (chunk: Buffer | string): void => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.#stdinBuffer = Buffer.concat([this.#stdinBuffer, bytes]);

    while (true) {
      const parsed = this.#tryReadFrame(this.#stdinBuffer);
      if (!parsed) {
        return;
      }

      this.#stdinBuffer = parsed.remaining;
      void this.#handleIncomingFrame(parsed.payload);
    }
  };

  #tryReadFrame(buffer: Buffer): { payload: string; remaining: Buffer } | null {
    const headerEndIndex = buffer.indexOf("\r\n\r\n");
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
      return { payload: "", remaining: Buffer.alloc(0) };
    }

    const bodyStartIndex = headerEndIndex + 4;
    const bodyEndIndex = bodyStartIndex + contentLength;
    if (buffer.length < bodyEndIndex) {
      return null;
    }

    return {
      payload: buffer.subarray(bodyStartIndex, bodyEndIndex).toString("utf8"),
      remaining: buffer.subarray(bodyEndIndex),
    };
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

    const request = raw as JsonRpcRequest;
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
        const payload = await this.#proxyToParent("initialize", request.params ?? {});
        return this.#normalizeInitializeResult(payload);
      }
      case "tools/list": {
        const payload = await this.#proxyToParent("tools/list", request.params ?? {});
        return this.#normalizeToolsListResult(payload);
      }
      case "tools/call": {
        if (!isObject(request.params) || typeof request.params.name !== "string") {
          throw new RpcError(-32602, "tools/call params must include a string name.");
        }
        return this.#proxyToParent("tools/call", request.params);
      }
      default:
        throw new RpcError(-32601, `Method not found: ${request.method}`);
    }
  }

  #normalizeInitializeResult(payload: unknown): Record<string, unknown> {
    const result = isObject(payload) ? payload : {};
    const serverInfo = isObject(result.serverInfo) ? result.serverInfo : {};

    const normalized: Record<string, unknown> = {
      protocolVersion: typeof result.protocolVersion === "string" ? result.protocolVersion : MCP_PROTOCOL_VERSION,
      capabilities: isObject(result.capabilities) ? result.capabilities : { tools: { listChanged: false } },
      serverInfo: {
        name: typeof serverInfo.name === "string" ? serverInfo.name : "kleiber-mcp-wrapper",
        version: typeof serverInfo.version === "string" ? serverInfo.version : "0.0.0",
      },
    };

    this.#orchestratorVersion = result.version ?? normalized.serverInfo?.version;
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
        inputSchema: tool.inputSchema as JsonSchema,
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

  #proxyToParent(method: RpcMethod, params: unknown): Promise<unknown> {
    const requestId = `req-${Date.now()}-${this.#nextRequestId}`;
    this.#nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new RpcError(-32603, `Timed out waiting for parent response to ${method}.`));
      }, this.#requestTimeoutMs);

      this.#pending.set(requestId, { resolve, reject, timeout });
      try {
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

    const response = message as ParentToWrapperResponse;
    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      return;
    }

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
    this.#streams.output.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  }
}

export function runMcpStdioWrapper(options: McpStdioWrapperOptions = {}): McpStdioWrapper {
  const wrapper = new McpStdioWrapper(options);
  wrapper.start();
  return wrapper;
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runMcpStdioWrapper();
}
