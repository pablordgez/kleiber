import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpSocketBridgeServer } from "./socket-transport";
import { McpStdioWrapper } from "./stdio-wrapper";

interface ParentRequestEnvelope {
  kind: "kleiber.mcp.request";
  requestId: string;
  method: string;
  params: unknown;
  context: {
    sessionId: string;
    projectId: string;
  };
}

interface ParentResponseEnvelope {
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

function encodeFrame(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function encodeLfFrame(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\n\n${body}`;
}

function encodeJsonLine(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

function extractFrames(output: string): unknown[] {
  const frames: unknown[] = [];
  let remaining = output;
  while (remaining.length > 0) {
    const headerEnd = remaining.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      break;
    }
    const header = remaining.slice(0, headerEnd);
    const contentLength = Number.parseInt(header.split(":")[1]?.trim() ?? "-1", 10);
    const start = headerEnd + 4;
    const end = start + contentLength;
    frames.push(JSON.parse(remaining.slice(start, end)));
    remaining = remaining.slice(end);
  }
  return frames;
}

function extractJsonLines(output: string): unknown[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

class ParentBridgeFake {
  readonly sent: ParentRequestEnvelope[] = [];
  #listener: ((message: unknown) => void) | null = null;

  send = vi.fn((message: ParentRequestEnvelope) => {
    this.sent.push(message);
    return true;
  });

  onMessage = (listener: (message: unknown) => void): (() => void) => {
    this.#listener = listener;
    return () => {
      if (this.#listener === listener) {
        this.#listener = null;
      }
    };
  };

  respond(message: ParentResponseEnvelope): void {
    this.#listener?.(message);
  }
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.KLEIBER_MCP_SOCKET_PATH;
});

describe("McpStdioWrapper", () => {
  it("proxies initialize and preserves orchestrator metadata for tools/list", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-17", projectId: "project-4" },
    });
    wrapper.start();

    input.write(encodeFrame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    await vi.waitFor(() => {
      expect(bridge.sent).toHaveLength(1);
    });

    const initializeReq = bridge.sent[0];
    expect(initializeReq).toMatchObject({
      method: "initialize",
      context: { sessionId: "session-17", projectId: "project-4" },
    });

    bridge.respond({
      kind: "kleiber.mcp.response",
      requestId: initializeReq?.requestId ?? "",
      ok: true,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "kleiber-orchestrator", version: "1.2.3" },
        version: "1.2.3",
      },
    });

    await vi.waitFor(() => {
      const frames = extractFrames(outputData);
      expect(frames).toHaveLength(1);
      expect((frames[0] as any).result.serverInfo.version).toBe("1.2.3");
    });

    input.write(encodeFrame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    await vi.waitFor(() => {
      expect(bridge.sent).toHaveLength(2);
    });

    const toolsReq = bridge.sent[1];
    bridge.respond({
      kind: "kleiber.mcp.response",
      requestId: toolsReq?.requestId ?? "",
      ok: true,
      result: {
        tools: [
          {
            name: "spawn_session",
            description: "custom",
            inputSchema: { type: "object" },
          },
        ],
      },
    });

    await vi.waitFor(() => {
      const frames = extractFrames(outputData);
      expect(frames).toHaveLength(2);
    });

    const frames = extractFrames(outputData) as any[];
    expect(frames[1]?.result.tools).toHaveLength(8);
    expect(frames[1]?.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "spawn_session",
      "send_to_session",
      "read_session",
      "list_sessions",
      "kill_session",
      "list_available_roles",
      "notify_parent",
      "wait_for_child_notification",
    ]);
    expect(frames[1]?.result.version).toBe("1.2.3");
    expect(frames[1]?.result.capabilities).toEqual({ tools: { listChanged: true } });

    wrapper.stop();
  });

  it("accepts LF-only MCP frame separators", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-lf", projectId: "project-lf" },
    });
    wrapper.start();

    input.write(encodeLfFrame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    await vi.waitFor(() => {
      expect(bridge.sent).toHaveLength(1);
    });

    bridge.respond({
      kind: "kleiber.mcp.response",
      requestId: bridge.sent[0]?.requestId ?? "",
      ok: true,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "kleiber-orchestrator", version: "1.0.0" },
        version: "1.0.0",
      },
    });

    await vi.waitFor(() => {
      const frames = extractFrames(outputData);
      expect(frames).toHaveLength(1);
    });

    wrapper.stop();
  });

  it("accepts newline-delimited JSON-RPC messages", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-jsonl", projectId: "project-jsonl" },
    });
    wrapper.start();

    input.write(encodeJsonLine({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    await vi.waitFor(() => {
      expect(bridge.sent).toHaveLength(1);
    });

    bridge.respond({
      kind: "kleiber.mcp.response",
      requestId: bridge.sent[0]?.requestId ?? "",
      ok: true,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "kleiber-orchestrator", version: "1.0.0" },
        version: "1.0.0",
      },
    });

    await vi.waitFor(() => {
      const frames = extractJsonLines(outputData);
      expect(frames).toHaveLength(1);
    });

    const frames = extractJsonLines(outputData) as any[];
    expect(frames[0]?.result.serverInfo.version).toBe("1.0.0");

    wrapper.stop();
  });

  it("normalizes raw tools/call payloads into MCP CallToolResult envelopes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-tools", projectId: "project-tools" },
    });
    wrapper.start();

    input.write(
      encodeJsonLine({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "spawn_session",
          arguments: {
            project_id: "project-tools",
            cli: "claude",
          },
        },
      }),
    );

    await vi.waitFor(() => {
      expect(bridge.sent).toHaveLength(1);
    });

    bridge.respond({
      kind: "kleiber.mcp.response",
      requestId: bridge.sent[0]?.requestId ?? "",
      ok: true,
      result: {
        session_id: "child-1",
        name: "Child Session",
        yolo: false,
      },
    });

    await vi.waitFor(() => {
      const frames = extractJsonLines(outputData) as any[];
      expect(frames).toHaveLength(1);
      expect(frames[0]?.result.content).toEqual([{ type: "text", text: "Session created." }]);
      expect(frames[0]?.result.structuredContent).toEqual({
        session_id: "child-1",
        name: "Child Session",
        yolo: false,
      });
      expect(frames[0]?.result.isError).toBe(false);
    });

    wrapper.stop();
  });

  it("normalizes notification tool payloads into MCP CallToolResult envelopes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-parent", projectId: "project-tools" },
    });
    wrapper.start();

    input.write(
      encodeJsonLine({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "wait_for_child_notification",
          arguments: {
            child_session_id: "child-1",
            timeout_ms: 0,
          },
        },
      }),
    );

    await vi.waitFor(() => {
      expect(bridge.sent).toHaveLength(1);
    });

    bridge.respond({
      kind: "kleiber.mcp.response",
      requestId: bridge.sent[0]?.requestId ?? "",
      ok: true,
      result: {
        notification: {
          kind: "child_exited",
          child_session_id: "child-1",
          child_session_name: "codex:architect",
          delivered_at: "2026-04-10T12:00:00.000Z",
          exit_code: 0,
          signal: null,
        },
        timed_out: false,
      },
    });

    await vi.waitFor(() => {
      const frames = extractJsonLines(outputData) as any[];
      expect(frames).toHaveLength(1);
      expect(frames[0]?.result.content).toEqual([{ type: "text", text: "Child notification received." }]);
      expect(frames[0]?.result.structuredContent).toEqual({
        notification: {
          kind: "child_exited",
          child_session_id: "child-1",
          child_session_name: "codex:architect",
          delivered_at: "2026-04-10T12:00:00.000Z",
          exit_code: 0,
          signal: null,
        },
        timed_out: false,
      });
    });

    wrapper.stop();
  });

  it("handles parse and request validation errors with JSON-RPC compliant codes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-1", projectId: "project-1" },
    });
    wrapper.start();

    input.write("Content-Length: 7\r\n\r\ninvalid");
    input.write(encodeFrame({ jsonrpc: "2.0", id: 4, method: "unknown/method" }));
    input.write(encodeFrame({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { arguments: {} } }));

    await vi.waitFor(() => {
      expect(extractFrames(outputData)).toHaveLength(3);
    });

    const frames = extractFrames(outputData) as Array<{ error?: { code: number } }>;
    expect(frames[0]?.error?.code).toBe(-32700);
    expect(frames[1]?.error?.code).toBe(-32601);
    expect(frames[2]?.error?.code).toBe(-32602);
    expect(bridge.send).not.toHaveBeenCalled();

    wrapper.stop();
  });

  it("returns internal error when parent IPC channel is unavailable", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    bridge.send.mockReturnValue(false);
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-1", projectId: "project-2" },
    });
    wrapper.start();

    input.write(encodeFrame({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} }));

    await vi.waitFor(() => {
      const frames = extractFrames(outputData);
      expect(frames).toHaveLength(1);
      expect((frames[0] as any).error.code).toBe(-32603);
    });

    wrapper.stop();
  });

  it("treats notifications/initialized as a no-op notification", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bridge = new ParentBridgeFake();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      bridge,
      context: { sessionId: "session-1", projectId: "project-2" },
    });
    wrapper.start();

    input.write(encodeFrame({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outputData).toBe("");
    expect(bridge.send).not.toHaveBeenCalled();

    wrapper.stop();
  });

  it("can proxy over the session socket bridge when no fork IPC is available", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outputData = "";
    output.on("data", (chunk) => {
      outputData += String(chunk);
    });

    const server = await createMcpSocketBridgeServer({
      sessionId: "session-socket",
      onRequest: async (message) => ({
        kind: "kleiber.mcp.response",
        requestId: message.requestId,
        ok: true,
        result:
          message.method === "initialize"
            ? {
                protocolVersion: "2025-03-26",
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "kleiber-orchestrator", version: "9.9.9" },
                version: "9.9.9",
              }
            : { tools: [] },
      }),
    });

    process.env.KLEIBER_MCP_SOCKET_PATH = server.socketPath;
    const originalSend = process.send;
    Object.defineProperty(process, "send", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const wrapper = new McpStdioWrapper({
      streams: { input, output },
      context: { sessionId: "session-socket", projectId: "project-socket" },
    });
    wrapper.start();

    input.write(encodeFrame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));

    await vi.waitFor(() => {
      const frames = extractFrames(outputData) as any[];
      expect(frames).toHaveLength(1);
      expect(frames[0]?.result.serverInfo.version).toBe("9.9.9");
    });

    wrapper.stop();
    await server.dispose();
    Object.defineProperty(process, "send", {
      value: originalSend,
      configurable: true,
      writable: true,
    });
  });
});
