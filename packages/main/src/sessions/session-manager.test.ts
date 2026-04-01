import assert from "node:assert/strict";
import test from "node:test";

import {
  SessionManager,
  type Disposable,
  type PtyExitEvent,
  type PtyFactory,
  type PtyProcess,
} from "./session-manager.js";

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

test("createSession transitions to running, forwards input, and delegates resize", async () => {
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
  assert.equal(session.state, "running");
  assert.deepEqual(updates, ["running"]);
  assert.deepEqual(pty?.writes, ["echo hello\n"]);
  assert.deepEqual(pty?.resizeCalls, [{ columns: 140, rows: 40 }]);
});

test("killSession cascades through descendants", async () => {
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

  assert.deepEqual(new Set(killedIds), new Set([parent.id, child.id, grandchild.id]));
  assert.equal(manager.getSession(parent.id)?.state, "exited");
  assert.equal(manager.getSession(child.id)?.state, "exited");
  assert.equal(manager.getSession(grandchild.id)?.state, "exited");
  assert.deepEqual(
    fakeFactory.created.map((pty) => pty.killCount),
    [1, 1, 1],
  );
});

test("readSession returns the newest lines and truncates oversized lines", async () => {
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
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.slice(0, 2), ["two", "three"]);
  assert.match(lines[2] ?? "", /\[truncated\]$/);
});

test("child sessions inherit yolo=false from a non-yolo parent", async () => {
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

  assert.equal(parent.yolo, false);
  assert.equal(child.yolo, false);
});

test("session-exited is emitted when the PTY exits within 1s", async () => {
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

  await assert.doesNotReject(async () => {
    await exitEvent;
  });

  assert.deepEqual(await exitEvent, { sessionId: session.id, exitCode: 7 });
  assert.equal(manager.getSession(session.id)?.state, "exited");
});
