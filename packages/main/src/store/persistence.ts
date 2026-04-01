import { safeStorage } from "electron";
import type { AppSettings, Project, RemoteApiCredentials } from "@kleiber/shared";
import { DEFAULT_THEME } from "@kleiber/shared";

import { decryptCredentials, encryptCredentials, type SafeStorageAdapter } from "./credentials";

const DEFAULT_SCHEMA_VERSION = 1;
const STORE_NAME = "kleiber";

const STORE_KEYS = {
  schemaVersion: "schemaVersion",
  projects: "projects",
  settings: "settings",
  remoteApiCredentials: "remoteApiCredentials",
} as const;

type StoreData = {
  schemaVersion: number;
  projects: Project[];
  settings: AppSettings;
  remoteApiCredentials: string | null;
};

type PartialStoreData = Partial<StoreData>;

type StoreShape = {
  get<K extends keyof PartialStoreData>(key: K): PartialStoreData[K] | undefined;
  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void;
  clear(): void;
};

type StoreConstructor = new (options: {
  name: string;
  clearInvalidConfig?: boolean;
  schema?: Record<string, unknown>;
  defaults?: PartialStoreData;
}) => StoreShape;

export interface PersistenceStoreOptions {
  createStore?: () => StoreShape;
  safeStorageAdapter?: SafeStorageAdapter;
  schemaVersion?: number;
  storeName?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  remoteApiEnabled: false,
  remoteApiPort: null,
  remoteApiBindAddress: "0.0.0.0",
  theme: DEFAULT_THEME,
  quickLaunchShortcut: "",
};

const STORE_SCHEMA: Record<string, unknown> = {
  [STORE_KEYS.schemaVersion]: { type: "number", minimum: 1, default: DEFAULT_SCHEMA_VERSION },
  [STORE_KEYS.projects]: { type: "array", default: [] },
  [STORE_KEYS.settings]: {
    type: "object",
    additionalProperties: false,
    required: ["remoteApiEnabled", "remoteApiPort", "remoteApiBindAddress", "theme", "quickLaunchShortcut"],
    properties: {
      remoteApiEnabled: { type: "boolean" },
      remoteApiPort: { anyOf: [{ type: "number" }, { type: "null" }] },
      remoteApiBindAddress: { type: "string", minLength: 1 },
      theme: { enum: ["dark", "light"] },
      quickLaunchShortcut: { type: "string" },
    },
  },
  [STORE_KEYS.remoteApiCredentials]: { anyOf: [{ type: "string" }, { type: "null" }], default: null },
};

function loadStoreConstructor(): StoreConstructor {
  const loaded = require("electron-store") as { default?: StoreConstructor };
  return loaded.default ?? (loaded as unknown as StoreConstructor);
}

function createDefaultStore(storeName: string, schemaVersion: number): StoreShape {
  const Store = loadStoreConstructor();
  return new Store({
    name: storeName,
    clearInvalidConfig: true,
    schema: STORE_SCHEMA,
    defaults: {
      schemaVersion,
      projects: [],
      settings: DEFAULT_SETTINGS,
      remoteApiCredentials: null,
    },
  });
}

export class PersistenceStore {
  readonly #expectedSchemaVersion: number;
  readonly #safeStorageAdapter: SafeStorageAdapter;
  readonly #store: StoreShape;

  constructor(options: PersistenceStoreOptions = {}) {
    this.#expectedSchemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
    this.#safeStorageAdapter = options.safeStorageAdapter ?? safeStorage;
    this.#store =
      options.createStore?.() ??
      createDefaultStore(options.storeName ?? STORE_NAME, this.#expectedSchemaVersion);

    this.#ensureSchemaVersion();
  }

  listProjects(): Project[] {
    return [...(this.#store.get(STORE_KEYS.projects) ?? [])];
  }

  getProject(projectId: string): Project | undefined {
    return this.listProjects().find((project) => project.id === projectId);
  }

  saveProject(project: Project): Project {
    const projects = this.listProjects();
    const duplicate = projects.find(
      (candidate) => candidate.name === project.name && candidate.id !== project.id,
    );

    if (duplicate) {
      throw new Error(`Project name "${project.name}" is already in use.`);
    }

    const nextProjects = projects.filter((candidate) => candidate.id !== project.id);
    nextProjects.push(project);
    this.#store.set(STORE_KEYS.projects, nextProjects);
    return project;
  }

  replaceProjects(projects: Project[]): void {
    const uniqueNames = new Set<string>();
    for (const project of projects) {
      if (uniqueNames.has(project.name)) {
        throw new Error(`Project name "${project.name}" is duplicated.`);
      }
      uniqueNames.add(project.name);
    }

    this.#store.set(STORE_KEYS.projects, [...projects]);
  }

  removeProject(projectId: string): boolean {
    const projects = this.listProjects();
    const nextProjects = projects.filter((project) => project.id !== projectId);
    if (nextProjects.length === projects.length) {
      return false;
    }

    this.#store.set(STORE_KEYS.projects, nextProjects);
    return true;
  }

  getSettings(): AppSettings {
    return this.#store.get(STORE_KEYS.settings) ?? { ...DEFAULT_SETTINGS };
  }

  setSettings(settings: AppSettings): AppSettings {
    this.#store.set(STORE_KEYS.settings, settings);
    return settings;
  }

  getSchemaVersion(): number {
    return this.#store.get(STORE_KEYS.schemaVersion) ?? this.#expectedSchemaVersion;
  }

  getRemoteApiCredentials(): RemoteApiCredentials | null {
    return decryptCredentials(
      this.#store.get(STORE_KEYS.remoteApiCredentials),
      this.#safeStorageAdapter,
    );
  }

  setRemoteApiCredentials(credentials: RemoteApiCredentials): void {
    this.#store.set(
      STORE_KEYS.remoteApiCredentials,
      encryptCredentials(credentials, this.#safeStorageAdapter),
    );
  }

  clearRemoteApiCredentials(): void {
    this.#store.set(STORE_KEYS.remoteApiCredentials, null);
  }

  clearAll(): void {
    this.#store.clear();
    this.#ensureSchemaVersion();
  }

  #ensureSchemaVersion(): void {
    const storedSchemaVersion = this.#store.get(STORE_KEYS.schemaVersion);

    if (typeof storedSchemaVersion !== "number") {
      this.#store.set(STORE_KEYS.schemaVersion, this.#expectedSchemaVersion);
      return;
    }

    if (storedSchemaVersion > this.#expectedSchemaVersion) {
      throw new Error(
        `Unsupported persistence schema version ${String(storedSchemaVersion)}. Expected <= ${String(
          this.#expectedSchemaVersion,
        )}.`,
      );
    }

    if (storedSchemaVersion < this.#expectedSchemaVersion) {
      this.#store.set(STORE_KEYS.schemaVersion, this.#expectedSchemaVersion);
    }
  }
}

export { DEFAULT_SCHEMA_VERSION };
