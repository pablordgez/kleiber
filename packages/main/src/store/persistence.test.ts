import { describe, expect, it } from "vitest";
import type { AppSettings, Project, RemoteApiCredentials } from "@kleiber/shared";

import { PersistenceStore } from "./persistence";
import type { SafeStorageAdapter } from "./credentials";

type StoreData = {
  schemaVersion?: number;
  projects?: Project[];
  settings?: AppSettings;
  remoteApiCredentials?: string | null;
};

class FakeStore {
  readonly #data: StoreData;

  constructor(initialData: StoreData = {}) {
    this.#data = { ...initialData };
  }

  get<K extends keyof StoreData>(key: K): StoreData[K] | undefined {
    return this.#data[key];
  }

  set<K extends keyof Required<StoreData>>(key: K, value: Required<StoreData>[K]): void {
    this.#data[key] = value;
  }

  clear(): void {
    for (const key of Object.keys(this.#data) as Array<keyof StoreData>) {
      delete this.#data[key];
    }
  }
}

class FakeSafeStorage implements SafeStorageAdapter {
  constructor(private readonly available: boolean) {}

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(plainText: string): Buffer {
    return Buffer.from(plainText, "utf8");
  }

  decryptString(cipherText: Buffer): string {
    return cipherText.toString("utf8");
  }
}

describe("PersistenceStore", () => {
  it("initializes and upgrades schema versions", () => {
    const emptyStore = new FakeStore();
    const initialized = new PersistenceStore({
      schemaVersion: 3,
      createStore: () => emptyStore,
      safeStorageAdapter: new FakeSafeStorage(true),
    });
    expect(initialized.getSchemaVersion()).toBe(3);

    const olderStore = new FakeStore({ schemaVersion: 1 });
    const upgraded = new PersistenceStore({
      schemaVersion: 2,
      createStore: () => olderStore,
      safeStorageAdapter: new FakeSafeStorage(true),
    });
    expect(upgraded.getSchemaVersion()).toBe(2);

    expect(
      () =>
        new PersistenceStore({
          schemaVersion: 2,
          createStore: () => new FakeStore({ schemaVersion: 4 }),
          safeStorageAdapter: new FakeSafeStorage(true),
        }),
    ).toThrow(/Unsupported persistence schema version/);
  });

  it("creates, updates, and removes projects with unique names", () => {
    const store = new PersistenceStore({
      createStore: () => new FakeStore(),
      safeStorageAdapter: new FakeSafeStorage(true),
    });

    const alpha: Project = {
      id: "alpha",
      name: "Alpha",
      directoryPath: "/tmp/alpha",
      yoloDefault: false,
      createdAt: new Date().toISOString(),
    };
    const beta: Project = { ...alpha, id: "beta", name: "Beta", directoryPath: "/tmp/beta" };

    store.saveProject(alpha);
    store.saveProject(beta);
    expect(store.listProjects()).toHaveLength(2);

    store.saveProject({ ...alpha, directoryPath: "/tmp/alpha-next" });
    expect(store.getProject("alpha")?.directoryPath).toBe("/tmp/alpha-next");

    expect(() => store.saveProject({ ...beta, id: "beta-2", name: "Alpha" })).toThrow(/already in use/);
    expect(store.removeProject("beta")).toBe(true);
    expect(store.removeProject("missing")).toBe(false);
    expect(store.listProjects()).toHaveLength(1);
  });

  it("persists settings and encrypts remote credentials", () => {
    const fakeStore = new FakeStore();
    const store = new PersistenceStore({
      createStore: () => fakeStore,
      safeStorageAdapter: new FakeSafeStorage(true),
    });
    const settings: AppSettings = {
      remoteApiEnabled: true,
      remoteApiPort: 9100,
      remoteApiBindAddress: "127.0.0.1",
      theme: "dark",
      quickLaunchShortcut: "Ctrl+Shift+K",
    };
    const credentials: RemoteApiCredentials = {
      username: "admin",
      passwordHash: "hashed-value",
    };

    store.setSettings(settings);
    store.setRemoteApiCredentials(credentials);

    expect(store.getSettings()).toEqual(settings);
    expect(fakeStore.get("remoteApiCredentials")).not.toBe(JSON.stringify(credentials));
    expect(store.getRemoteApiCredentials()).toEqual(credentials);
  });

  it("rejects plaintext credential storage when safeStorage is unavailable", () => {
    const store = new PersistenceStore({
      createStore: () => new FakeStore(),
      safeStorageAdapter: new FakeSafeStorage(false),
    });

    expect(() =>
      store.setRemoteApiCredentials({
        username: "admin",
        passwordHash: "hashed-value",
      }),
    ).toThrow(/safeStorage encryption is not available/);
    expect(store.getRemoteApiCredentials()).toBeNull();
  });
});
