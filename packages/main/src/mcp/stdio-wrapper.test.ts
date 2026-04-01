import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(frames[1]?.result.tools).toHaveLength(5);
    expect(frames[1]?.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "spawn_session",
      "send_to_session",
      "read_session",
      "list_sessions",
      "kill_session",
    ]);
    expect(frames[1]?.result.version).toBe("1.2.3");
    expect(frames[1]?.result.capabilities).toEqual({ tools: { listChanged: true } });

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
});
