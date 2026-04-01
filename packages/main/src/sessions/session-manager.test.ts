import { describe, expect, it, vi } from "vitest";

import {
  SessionManager,
  type Disposable,
  type McpWrapperFactory,
  type PtyExitEvent,
  type PtyFactory,
  type PtyProcess,
} from "./session-manager";

class FakePty implements PtyProcess {
  readonly #dataListeners = new Set<(data: string) => void>();
  readonly #exitListeners = new Set<(event: PtyExitEvent) => void>();

  readonly pid: number;
  readonly writes: string[] = [];
  readonly resizeCalls: Array<{ columns: number; rows: number }> = [];
  killCount = 0;
  exited = false;

  constructor(pid: number) {
    this.pid = pid;
  }

  write(input: string): void {
    this.writes.push(input);
  }

  resize(columns: number, rows: number): void {
    this.resizeCalls.push({ columns, rows });
  }

  kill(): void {
    this.killCount += 1;
    this.emitExit({ exitCode: 0, signal: null });
  }

  onData(listener: (data: string) => void): Disposable {
    this.#dataListeners.add(listener);
    return {
      dispose: () => {
        this.#dataListeners.delete(listener);
      },
    };
  }

  onExit(listener: (event: PtyExitEvent) => void): Disposable {
    this.#exitListeners.add(listener);
    return {
      dispose: () => {
        this.#exitListeners.delete(listener);
      },
    };
  }

  emitData(data: string): void {
    for (const listener of this.#dataListeners) {
      listener(data);
    }
  }

  emitExit(event: PtyExitEvent): void {
    if (this.exited) {
      return;
    }

    this.exited = true;
    for (const listener of this.#exitListeners) {
      listener(event);
    }
  }
}

class FakePtyFactory {
  readonly created: FakePty[] = [];
  #nextPid = 1000;

  readonly factory: PtyFactory = async () => {
    const pty = new FakePty(this.#nextPid);
    this.#nextPid += 1;
    this.created.push(pty);
    return pty;
  };
}

function createManager(factory: PtyFactory, outputBufferSize = 5): SessionManager {
  return new SessionManager({
    ptyFactory: factory,
    outputBufferSize,
  });
}

class FakeMcpWrapperFactory {
  readonly created: Array<{ sessionId: string; projectId: string; dispose: ReturnType<typeof vi.fn> }> = [];
  #nextPid = 9_000;

  readonly factory: McpWrapperFactory = async ({ sessionId, projectId }) => {
    const dispose = vi.fn();
    this.created.push({ sessionId, projectId, dispose });
    const pid = this.#nextPid;
    this.#nextPid += 1;

    return {
      pid,
      dispose,
    };
  };
}

describe("SessionManager", () => {
it("createSession transitions to running, forwards input, and delegates resize", async () => {
  const fakeFactory = new FakePtyFactory();
  const manager = createManager(fakeFactory.factory);
  const updates: string[] = [];

  manager.on("session-updated", ({ session }) => {
    updates.push(session.state);
  });

  const session = await manager.createSession({
    projectId: "project-1",
    workingDirectory: "/tmp",
  });

  manager.sendToSession(session.id, "echo hello\n");
  manager.resizeSession(session.id, { columns: 140, rows: 40 });

  const pty = fakeFactory.created[0];
  expect(session.state).toBe("running");
  expect(updates).toEqual(["running"]);
  expect(pty?.writes).toEqual(["echo hello\n"]);
  expect(pty?.resizeCalls).toEqual([{ columns: 140, rows: 40 }]);
});

it("killSession cascades through descendants", async () => {
  const fakeFactory = new FakePtyFactory();
  const manager = createManager(fakeFactory.factory);

  const parent = await manager.createSession({
    projectId: "project-1",
    workingDirectory: "/tmp",
  });
  const child = await manager.createSession({
    projectId: "project-1",
    parentSessionId: parent.id,
    workingDirectory: "/tmp",
  });
  const grandchild = await manager.createSession({
    projectId: "project-1",
    parentSessionId: child.id,
    workingDirectory: "/tmp",
  });

  const killedIds = manager.killSession(parent.id);

  expect(new Set(killedIds)).toEqual(new Set([parent.id, child.id, grandchild.id]));
  expect(manager.getSession(parent.id)?.state).toBe("exited");
  expect(manager.getSession(child.id)?.state).toBe("exited");
  expect(manager.getSession(grandchild.id)?.state).toBe("exited");
  expect(
    fakeFactory.created.map((pty) => pty.killCount),
  ).toEqual([1, 1, 1]);
});

it("readSession returns the newest lines and truncates oversized lines", async () => {
  const fakeFactory = new FakePtyFactory();
  const manager = createManager(fakeFactory.factory, 3);
  const session = await manager.createSession({
    projectId: "project-1",
    workingDirectory: "/tmp",
  });

  const pty = fakeFactory.created[0];
  pty?.emitData("one\ntwo\n");
  pty?.emitData(`three\n${"x".repeat(10_100)}\n`);
  pty?.emitExit({ exitCode: 0, signal: null });

  const lines = manager.readSession(session.id);
  expect(lines).toHaveLength(3);
  expect(lines.slice(0, 2)).toEqual(["two", "three"]);
  expect(lines[2] ?? "").toMatch(/\[truncated\]$/);
});

it("child sessions inherit yolo=false from a non-yolo parent", async () => {
  const fakeFactory = new FakePtyFactory();
  const manager = createManager(fakeFactory.factory);

  const parent = await manager.createSession({
    projectId: "project-1",
    workingDirectory: "/tmp",
    requestedYolo: false,
  });
  const child = await manager.createSession({
    projectId: "project-1",
    parentSessionId: parent.id,
    workingDirectory: "/tmp",
    requestedYolo: true,
  });

  expect(parent.yolo).toBe(false);
  expect(child.yolo).toBe(false);
});

it("session-exited is emitted when the PTY exits within 1s", async () => {
  const fakeFactory = new FakePtyFactory();
  const manager = createManager(fakeFactory.factory);
  const session = await manager.createSession({
    projectId: "project-1",
    workingDirectory: "/tmp",
  });
  const pty = fakeFactory.created[0];

  const exitEvent = new Promise<{ sessionId: string; exitCode: number | null }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for session exit."));
    }, 1_000);

    manager.once("session-exited", ({ session: exitedSession }) => {
      clearTimeout(timeout);
      resolve({ sessionId: exitedSession.id, exitCode: exitedSession.exitCode });
    });
  });

  setTimeout(() => {
    pty?.emitExit({ exitCode: 7, signal: null });
  }, 50);

  await expect(exitEvent).resolves.toEqual({ sessionId: session.id, exitCode: 7 });
  expect(manager.getSession(session.id)?.state).toBe("exited");
});

it("starts and disposes MCP wrappers for MCP-enabled agent sessions", async () => {
  const fakeFactory = new FakePtyFactory();
  const fakeMcpFactory = new FakeMcpWrapperFactory();
  const manager = new SessionManager({
    ptyFactory: fakeFactory.factory,
    outputBufferSize: 5,
    mcpWrapperFactory: fakeMcpFactory.factory,
  });

  const session = await manager.createSession({
    projectId: "project-1",
    type: "agent",
    cli: "claude",
    workingDirectory: "/tmp",
    mcpEnabled: true,
    mcpLaunchConfig: {
      injectionMethod: "env",
      wrapperCommand: process.execPath,
      wrapperArgs: ["/tmp/fake-wrapper.js"],
    },
    launch: {
      command: "claude",
      args: [],
      env: {},
    },
  });

  expect(fakeMcpFactory.created).toHaveLength(1);
  expect(fakeMcpFactory.created[0]).toMatchObject({
    sessionId: session.id,
    projectId: "project-1",
  });
  expect(session.mcpWrapperId).toBe(9_000);

  fakeFactory.created[0]?.emitExit({ exitCode: 0, signal: null });
  expect(fakeMcpFactory.created[0]?.dispose).toHaveBeenCalledTimes(1);
});
});
