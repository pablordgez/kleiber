import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersistenceStore, DEFAULT_SETTINGS } from "../persistence";
import type { Project, AppSettings } from "@kleiber/shared";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((text: string) => Buffer.from(text, "utf8")),
    decryptString: vi.fn((buf: Buffer) => buf.toString("utf8")),
  },
}));

function makeInMemoryStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: vi.fn(<K extends string>(key: K) => data[key] as undefined),
    set: vi.fn(<K extends string>(key: K, value: unknown) => {
      data[key] = value;
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(data)) {
        delete data[key];
      }
    }),
    _data: data,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Alpha",
    workingDirectory: "/tmp/alpha",
    ...overrides,
  } as Project;
}

describe("PersistenceStore", () => {
  describe("project CRUD", () => {
    it("lists projects (empty by default)", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      expect(ps.listProjects()).toEqual([]);
    });

    it("saves and retrieves a project", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      const project = makeProject();
      ps.saveProject(project);
      expect(ps.getProject("proj-1")).toMatchObject({ id: "proj-1", name: "Alpha" });
    });

    it("updating an existing project replaces it", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      ps.saveProject(makeProject({ id: "proj-1", name: "Alpha" }));
      ps.saveProject(makeProject({ id: "proj-1", name: "Alpha-updated" }));
      expect(ps.listProjects()).toHaveLength(1);
      expect(ps.getProject("proj-1")?.name).toBe("Alpha-updated");
    });

    it("throws on duplicate project name with different id", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      ps.saveProject(makeProject({ id: "proj-1", name: "Alpha" }));
      expect(() =>
        ps.saveProject(makeProject({ id: "proj-2", name: "Alpha" })),
      ).toThrow(/already in use/);
    });

    it("removes a project and returns true", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      ps.saveProject(makeProject());
      expect(ps.removeProject("proj-1")).toBe(true);
      expect(ps.listProjects()).toHaveLength(0);
    });

    it("returns false when removing a non-existent project", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      expect(ps.removeProject("nope")).toBe(false);
    });

    it("replaceProjects replaces the full list", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      ps.saveProject(makeProject({ id: "proj-1", name: "Alpha" }));
      ps.replaceProjects([makeProject({ id: "proj-2", name: "Beta" })]);
      expect(ps.listProjects()).toHaveLength(1);
      expect(ps.getProject("proj-2")?.name).toBe("Beta");
    });

    it("replaceProjects throws on duplicate name", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      expect(() =>
        ps.replaceProjects([
          makeProject({ id: "proj-1", name: "Alpha" }),
          makeProject({ id: "proj-2", name: "Alpha" }),
        ]),
      ).toThrow(/duplicated/);
    });
  });

  describe("settings", () => {
    it("returns DEFAULT_SETTINGS when no settings are stored", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store });
      expect(ps.getSettings()).toMatchObject(DEFAULT_SETTINGS);
    });

    it("persists updated settings", () => {
      const store = makeInMemoryStore({
        schemaVersion: 1,
        projects: [],
        settings: DEFAULT_SETTINGS,
      });
      const ps = new PersistenceStore({ createStore: () => store });
      const updated: AppSettings = {
        ...DEFAULT_SETTINGS,
        remoteApiEnabled: true,
        remoteApiPort: 4000,
      };
      ps.setSettings(updated);
      expect(ps.getSettings()).toMatchObject({ remoteApiEnabled: true, remoteApiPort: 4000 });
    });
  });

  describe("schema versioning", () => {
    it("migrates old schema version upward", () => {
      const store = makeInMemoryStore({ schemaVersion: 0, projects: [] });
      const ps = new PersistenceStore({ createStore: () => store, schemaVersion: 1 });
      expect(ps.getSchemaVersion()).toBe(1);
    });

    it("throws when stored schema version is newer than expected", () => {
      const store = makeInMemoryStore({ schemaVersion: 99, projects: [] });
      expect(() => new PersistenceStore({ createStore: () => store, schemaVersion: 1 })).toThrow(
        /Unsupported/,
      );
    });

    it("accepts matching schema version without migration", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      expect(() => new PersistenceStore({ createStore: () => store, schemaVersion: 1 })).not.toThrow();
    });
  });

  describe("credentials encrypt/decrypt round-trip", () => {
    it("stores and retrieves credentials via safeStorage", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const mockSafeStorage = {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((text: string) => Buffer.from(text, "utf8")),
        decryptString: vi.fn((buf: Buffer) => buf.toString("utf8")),
      };
      const ps = new PersistenceStore({
        createStore: () => store,
        safeStorageAdapter: mockSafeStorage,
      });
      const creds = { token: "secret-token-abc" } as any;
      ps.setRemoteApiCredentials(creds);
      expect(ps.getRemoteApiCredentials()).toEqual(creds);
    });

    it("returns null when encryption is unavailable", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const mockSafeStorage = {
        isEncryptionAvailable: vi.fn(() => false),
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      };
      const ps = new PersistenceStore({
        createStore: () => store,
        safeStorageAdapter: mockSafeStorage,
      });
      expect(ps.getRemoteApiCredentials()).toBeNull();
    });

    it("clearRemoteApiCredentials removes stored credentials", () => {
      const store = makeInMemoryStore({ schemaVersion: 1, projects: [] });
      const mockSafeStorage = {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((text: string) => Buffer.from(text, "utf8")),
        decryptString: vi.fn((buf: Buffer) => buf.toString("utf8")),
      };
      const ps = new PersistenceStore({
        createStore: () => store,
        safeStorageAdapter: mockSafeStorage,
      });
      ps.setRemoteApiCredentials({ token: "abc" } as any);
      ps.clearRemoteApiCredentials();
      expect(ps.getRemoteApiCredentials()).toBeNull();
    });
  });

  describe("clearAll", () => {
    it("clears all data and re-ensures schema version", () => {
      const store = makeInMemoryStore({
        schemaVersion: 1,
        projects: [makeProject()],
      });
      const ps = new PersistenceStore({ createStore: () => store });
      ps.clearAll();
      // After clear, store.clear() is called; the in-memory data map is emptied
      // then #ensureSchemaVersion sets it again via store.set
      expect(store.clear).toHaveBeenCalledOnce();
    });
  });
});
