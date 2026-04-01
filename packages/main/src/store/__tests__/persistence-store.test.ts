import test from "node:test";
import assert from "node:assert/strict";
import type { AppSettings, Project, RemoteApiCredentials } from "../persistence-store";
import { PersistenceStore } from "../persistence-store";

type StoreData = {
  schemaVersion?: number;
  projects?: Project[];
  settings?: AppSettings;
  remoteApiCredentials?: string | null;
};

class FakeStore {
  private readonly data: StoreData;

  constructor(initialData: StoreData = {}) {
    this.data = { ...initialData };
  }

  get<K extends keyof StoreData>(key: K): StoreData[K] | undefined {
    return this.data[key];
  }

  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    this.data[key] = value;
  }

  clear(): void {
    for (const key of Object.keys(this.data) as (keyof StoreData)[]) {
      delete this.data[key];
    }
  }
}

class FakeSafeStorage {
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

test("initializes schema version when missing", () => {
  const fakeStore = new FakeStore();
  const store = new PersistenceStore({
    schemaVersion: 3,
    createStore: () => fakeStore,
    safeStorageAdapter: new FakeSafeStorage(true),
  });

  assert.equal(store.getSchemaVersion(), 3);
});

test("upgrades schema version when lower", () => {
  const fakeStore = new FakeStore({ schemaVersion: 1 });
  const store = new PersistenceStore({
    schemaVersion: 2,
    createStore: () => fakeStore,
    safeStorageAdapter: new FakeSafeStorage(true),
  });

  assert.equal(store.getSchemaVersion(), 2);
});

test("throws when stored schema version is newer than supported", () => {
  const fakeStore = new FakeStore({ schemaVersion: 4 });

  assert.throws(
    () =>
      new PersistenceStore({
        schemaVersion: 3,
        createStore: () => fakeStore,
        safeStorageAdapter: new FakeSafeStorage(true),
      }),
    /Unsupported persistence schema version/,
  );
});

test("stores and retrieves encrypted remote API credentials", () => {
  const fakeStore = new FakeStore();
  const credentials: RemoteApiCredentials = {
    username: "admin",
    passwordHash: "hash-value",
  };

  const store = new PersistenceStore({
    createStore: () => fakeStore,
    safeStorageAdapter: new FakeSafeStorage(true),
  });
  store.setRemoteApiCredentials(credentials);

  const storedValue = fakeStore.get("remoteApiCredentials");
  assert.equal(typeof storedValue, "string");
  assert.ok(storedValue !== JSON.stringify(credentials));
  assert.deepEqual(store.getRemoteApiCredentials(), credentials);
});

test("rejects storing credentials when safeStorage encryption is unavailable", () => {
  const fakeStore = new FakeStore();
  const store = new PersistenceStore({
    createStore: () => fakeStore,
    safeStorageAdapter: new FakeSafeStorage(false),
  });

  assert.throws(
    () =>
      store.setRemoteApiCredentials({
        username: "admin",
        passwordHash: "hash-value",
      }),
    /safeStorage encryption is not available/,
  );
});

test("returns null credentials when safeStorage decryption is unavailable", () => {
  const fakeStore = new FakeStore({
    remoteApiCredentials: Buffer.from(
      JSON.stringify({ username: "admin", passwordHash: "hash-value" }),
      "utf8",
    ).toString("base64"),
  });
  const store = new PersistenceStore({
    createStore: () => fakeStore,
    safeStorageAdapter: new FakeSafeStorage(false),
  });

  assert.equal(store.getRemoteApiCredentials(), null);
});
