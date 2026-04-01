import { safeStorage } from "electron";

export interface Project {
  id: string;
  name: string;
  directoryPath: string;
  yoloDefault: boolean;
  createdAt: string;
}

export interface AppSettings {
  remoteApiEnabled: boolean;
  remoteApiPort: number | null;
  remoteApiBindAddress: string;
  theme: "dark" | "light";
  quickLaunchShortcut: string;
}

export interface RemoteApiCredentials {
  username: string;
  passwordHash: string;
}

const DEFAULT_SCHEMA_VERSION = 1;

const STORE_KEYS = {
  schemaVersion: "schemaVersion",
  projects: "projects",
  settings: "settings",
  remoteApiCredentials: "remoteApiCredentials",
} as const;

type StoreValues = {
  schemaVersion: number;
  projects: Project[];
  settings: AppSettings;
  remoteApiCredentials: string | null;
};

type StoreShape = Partial<StoreValues>;

type ElectronStore<T> = {
  get<K extends keyof T>(key: K): T[K] | undefined;
  set<K extends keyof T>(key: K, value: T[K]): void;
  clear(): void;
};

type ElectronStoreConstructor<T> = new (options: {
  name: string;
  clearInvalidConfig?: boolean;
  schema?: Record<string, unknown>;
  defaults?: Partial<T>;
}) => ElectronStore<T>;

type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
};

export interface PersistenceStoreOptions {
  storeName?: string;
  schemaVersion?: number;
  createStore?: () => ElectronStore<StoreShape>;
  safeStorageAdapter?: SafeStorageLike;
}

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

const DEFAULT_SETTINGS: AppSettings = {
  remoteApiEnabled: false,
  remoteApiPort: null,
  remoteApiBindAddress: "0.0.0.0",
  theme: "dark",
  quickLaunchShortcut: "",
};

function loadElectronStoreConstructor(): ElectronStoreConstructor<StoreShape> {
  const moduleName = "electron-store";
  const loaded = require(moduleName) as { default?: unknown };
  const storeConstructor = (loaded.default ?? loaded) as ElectronStoreConstructor<StoreShape>;
  return storeConstructor;
}

function createDefaultStore(storeName: string, schemaVersion: number): ElectronStore<StoreShape> {
  const Store = loadElectronStoreConstructor();
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
  private readonly expectedSchemaVersion: number;
  private readonly store: ElectronStore<StoreShape>;
  private readonly safeStorageAdapter: SafeStorageLike;

  constructor(options: PersistenceStoreOptions = {}) {
    this.expectedSchemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
    this.safeStorageAdapter = options.safeStorageAdapter ?? safeStorage;
    const createStore =
      options.createStore ?? (() => createDefaultStore(options.storeName ?? "kleiber", this.expectedSchemaVersion));
    this.store = createStore();
    this.ensureSchemaVersion();
  }

  getProjects(): Project[] {
    return this.store.get(STORE_KEYS.projects) ?? [];
  }

  setProjects(projects: Project[]): void {
    this.store.set(STORE_KEYS.projects, projects);
  }

  getSettings(): AppSettings {
    return this.store.get(STORE_KEYS.settings) ?? { ...DEFAULT_SETTINGS };
  }

  setSettings(settings: AppSettings): void {
    this.store.set(STORE_KEYS.settings, settings);
  }

  getSchemaVersion(): number {
    return this.store.get(STORE_KEYS.schemaVersion) ?? this.expectedSchemaVersion;
  }

  setRemoteApiCredentials(credentials: RemoteApiCredentials): void {
    if (!this.safeStorageAdapter.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption is not available on this system.");
    }

    const payload = JSON.stringify(credentials);
    const encrypted = this.safeStorageAdapter.encryptString(payload).toString("base64");
    this.store.set(STORE_KEYS.remoteApiCredentials, encrypted);
  }

  getRemoteApiCredentials(): RemoteApiCredentials | null {
    const encrypted = this.store.get(STORE_KEYS.remoteApiCredentials);
    if (!encrypted) {
      return null;
    }

    if (!this.safeStorageAdapter.isEncryptionAvailable()) {
      return null;
    }

    try {
      const decrypted = this.safeStorageAdapter.decryptString(Buffer.from(encrypted, "base64"));
      return JSON.parse(decrypted) as RemoteApiCredentials;
    } catch {
      return null;
    }
  }

  clearRemoteApiCredentials(): void {
    this.store.set(STORE_KEYS.remoteApiCredentials, null);
  }

  private ensureSchemaVersion(): void {
    const current = this.store.get(STORE_KEYS.schemaVersion);

    if (typeof current !== "number") {
      this.store.set(STORE_KEYS.schemaVersion, this.expectedSchemaVersion);
      return;
    }

    if (current > this.expectedSchemaVersion) {
      throw new Error(
        `Unsupported persistence schema version ${String(current)}. Expected <= ${String(this.expectedSchemaVersion)}.`,
      );
    }

    if (current < this.expectedSchemaVersion) {
      this.store.set(STORE_KEYS.schemaVersion, this.expectedSchemaVersion);
    }
  }

  clearAll(): void {
    this.store.clear();
    this.ensureSchemaVersion();
  }
}

export { DEFAULT_SCHEMA_VERSION, DEFAULT_SETTINGS };
