import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { SessionManager } from "../session-manager";
import type { PtyProcess, PtyExitEvent } from "../session-manager";

// Mock electron (safeStorage) – pulled in transitively
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// Mock the mcp socket transport helper so it doesn't need the real electron path
vi.mock("../../mcp/socket-transport", () => ({
  resolveMcpSocketPath: vi.fn((sessionId: string) => `/tmp/kleiber-mcp-${sessionId}.sock`),
}));

type MockPty = PtyProcess & {
  _emitData: (data: string) => void;
  _emitExit: (event: PtyExitEvent) => void;
};

function makeMockPty(pid = 1234): MockPty {
  const emitter = new EventEmitter();
  return {
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (listener: (data: string) => void) => {
      emitter.on("data", listener);
      return { dispose: () => emitter.off("data", listener) };
    },
    onExit: (listener: (event: PtyExitEvent) => void) => {
      emitter.on("exit", listener);
      return { dispose: () => emitter.off("exit", listener) };
    },
    _emitData: (data: string) => emitter.emit("data", data),
    _emitExit: (event: PtyExitEvent) => emitter.emit("exit", event),
  };
}

const PROJECT_ID = "00000000-0000-0000-0000-000000000001" as any;

describe("SessionManager", () => {
  let mockPty: MockPty;
  let manager: SessionManager;

  beforeEach(() => {
    mockPty = makeMockPty();
    manager = new SessionManager({ ptyFactory: () => mockPty });
  });

  describe("createSession", () => {
    it("returns state=running after spawn", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });
      expect(session.state).toBe("running");
      expect(session.pid).toBe(1234);
    });

    it("emits session-created event", async () => {
      const handler = vi.fn();
      manager.on("session-created", handler);
      await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });
      expect(handler).toHaveBeenCalledOnce();
      // session-created fires when the session is registered (state=starting),
      // before the PTY finishes spawning and transitions to running
      expect(handler.mock.calls[0][0].session.state).toBe("starting");
    });

    it("sets name to 'shell' for plain sessions without explicit name", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });
      expect(session.name).toBe("shell");
    });

    it("uses explicit name when provided", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
        name: "My Shell",
      });
      expect(session.name).toBe("My Shell");
    });

    it("stores parentSessionId on child session", async () => {
      const parent = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });
      const child = await manager.createSession({
        projectId: PROJECT_ID,
        parentSessionId: parent.id,
        workingDirectory: "/tmp",
        type: "plain",
      });
      expect(child.parentSessionId).toBe(parent.id);
    });
  });

  describe("yolo inheritance", () => {
    it("child inherits yolo=false from parent regardless of requested yolo", async () => {
      const parent = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
        requestedYolo: false,
      });

      const child = await manager.createSession({
        projectId: PROJECT_ID,
        parentSessionId: parent.id,
        workingDirectory: "/tmp",
        type: "plain",
        requestedYolo: true, // requested true but parent is false → overridden
      });

      expect(parent.yolo).toBe(false);
      expect(child.yolo).toBe(false);
    });

    it("child inherits yolo=true from parent when parent is yolo", async () => {
      const parent = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
        requestedYolo: true,
      });

      const child = await manager.createSession({
        projectId: PROJECT_ID,
        parentSessionId: parent.id,
        workingDirectory: "/tmp",
        type: "plain",
        requestedYolo: true,
      });

      expect(child.yolo).toBe(true);
    });

    it("uses defaultYolo when requestedYolo is not set", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
        defaultYolo: true,
      });
      expect(session.yolo).toBe(true);
    });
  });

  describe("output buffer", () => {
    it("stores output lines in the circular buffer", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });

      mockPty._emitData("line1\nline2\n");
      const lines = manager.readSession(session.id);
      expect(lines).toContain("line1");
      expect(lines).toContain("line2");
    });

    it("emits session-output event with appended lines", async () => {
      await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });

      const outputHandler = vi.fn();
      manager.on("session-output", outputHandler);
      mockPty._emitData("hello\nworld\n");

      expect(outputHandler).toHaveBeenCalled();
      const event = outputHandler.mock.calls[0][0];
      expect(event.appendedLines).toContain("hello");
      expect(event.appendedLines).toContain("world");
    });
  });

  describe("killSession", () => {
    it("kills the pty and returns session id", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });

      const killed = manager.killSession(session.id);
      expect(killed).toContain(session.id);
      expect(mockPty.kill).toHaveBeenCalled();
    });

    it("cascade-kills parent and all child sessions", async () => {
      const childPty = makeMockPty(5678);
      let spawnCount = 0;
      const cascadeManager = new SessionManager({
        ptyFactory: () => {
          spawnCount++;
          return spawnCount === 1 ? mockPty : childPty;
        },
      });

      const parent = await cascadeManager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });
      const child = await cascadeManager.createSession({
        projectId: PROJECT_ID,
        parentSessionId: parent.id,
        workingDirectory: "/tmp",
        type: "plain",
      });

      const killed = cascadeManager.killSession(parent.id);
      expect(killed).toContain(parent.id);
      expect(killed).toContain(child.id);
      expect(mockPty.kill).toHaveBeenCalled();
      expect(childPty.kill).toHaveBeenCalled();
    });

    it("emits session-killed event", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });

      const handler = vi.fn();
      manager.on("session-killed", handler);
      manager.killSession(session.id);
      expect(handler).toHaveBeenCalledOnce();
    });

    it("throws when trying to kill unknown session", () => {
      expect(() => manager.killSession("non-existent-id" as any)).toThrow(/Unknown session/);
    });
  });

  describe("PTY exit handling", () => {
    it("transitions state to exited when PTY emits exit", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });

      const exitedPromise = new Promise<void>((resolve) => {
        manager.once("session-exited", resolve);
      });

      mockPty._emitExit({ exitCode: 0, signal: null });
      await exitedPromise;

      const updated = manager.getSession(session.id);
      expect(updated?.state).toBe("exited");
      expect(updated?.exitCode).toBe(0);
    });

    it("records non-zero exit code", async () => {
      const session = await manager.createSession({
        projectId: PROJECT_ID,
        workingDirectory: "/tmp",
        type: "plain",
      });

      const exitedPromise = new Promise<void>((resolve) => {
        manager.once("session-exited", resolve);
      });

      mockPty._emitExit({ exitCode: 1, signal: null });
      await exitedPromise;

      const updated = manager.getSession(session.id);
      expect(updated?.exitCode).toBe(1);
    });
  });

  describe("getSession / listSessions", () => {
    it("getSession returns undefined for unknown id", () => {
      expect(manager.getSession("unknown" as any)).toBeUndefined();
    });

    it("listSessions returns all sessions", async () => {
      await manager.createSession({ projectId: PROJECT_ID, workingDirectory: "/tmp", type: "plain" });
      await manager.createSession({ projectId: PROJECT_ID, workingDirectory: "/tmp", type: "plain" });
      expect(manager.listSessions()).toHaveLength(2);
    });

    it("listSessions filters by projectId", async () => {
      const OTHER_PROJECT = "00000000-0000-0000-0000-000000000002" as any;
      await manager.createSession({ projectId: PROJECT_ID, workingDirectory: "/tmp", type: "plain" });
      await manager.createSession({ projectId: OTHER_PROJECT, workingDirectory: "/tmp", type: "plain" });
      expect(manager.listSessions(PROJECT_ID)).toHaveLength(1);
    });
  });
});
