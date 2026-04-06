import path from "node:path";
import os from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- mocks ---

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn() },
}));

const mockSpawnSync = vi.fn();
vi.mock("node:child_process", () => ({ spawnSync: mockSpawnSync }));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockStatSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  statSync: mockStatSync,
}));

// Helper to configure statSync so that a set of directories appear to exist
function mockDirs(...dirs: string[]) {
  mockExistsSync.mockImplementation((p: string) => dirs.includes(p));
  mockStatSync.mockImplementation((p: string) => {
    if (dirs.includes(p)) return { isDirectory: () => true };
    throw new Error("ENOENT");
  });
}

describe("fixPath", () => {
  const home = os.homedir();
  let savedPath: string | undefined;
  let savedShell: string | undefined;
  let savedNvmDir: string | undefined;

  beforeEach(() => {
    savedPath = process.env.PATH;
    savedShell = process.env.SHELL;
    savedNvmDir = process.env.NVM_DIR;
    process.env.PATH = "/usr/bin:/bin";
    process.env.SHELL = "/bin/bash";
    delete process.env.NVM_DIR;
    mockSpawnSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockStatSync.mockReset();
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    process.env.SHELL = savedShell;
    if (savedNvmDir !== undefined) {
      process.env.NVM_DIR = savedNvmDir;
    } else {
      delete process.env.NVM_DIR;
    }
    vi.resetModules();
  });

  it("applies the PATH returned by the login shell", async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/nvm/bin:/usr/bin:/bin", stderr: "" });
    mockDirs(); // no extra probe dirs exist

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(process.env.PATH).toBe("/nvm/bin:/usr/bin:/bin");
  });

  it("keeps the inherited PATH when the shell returns empty stdout", async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "" });
    mockDirs();

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });

  it("keeps the inherited PATH when the shell spawn throws", async () => {
    mockSpawnSync.mockImplementation(() => { throw new Error("spawn error"); });
    mockDirs();

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });

  it("prepends probed paths that are missing from PATH", async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin:/bin", stderr: "" });
    const voltaBin = path.join(home, ".volta", "bin");
    mockDirs(voltaBin);

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(process.env.PATH).toBe(`${voltaBin}:/usr/bin:/bin`);
  });

  it("does not duplicate a probed path already present in PATH", async () => {
    const voltaBin = path.join(home, ".volta", "bin");
    mockSpawnSync.mockReturnValue({ status: 0, stdout: `${voltaBin}:/usr/bin:/bin`, stderr: "" });
    mockDirs(voltaBin);

    const { fixPath } = await import("./fix-path");
    fixPath();

    const entries = (process.env.PATH ?? "").split(path.delimiter);
    expect(entries.filter((e) => e === voltaBin)).toHaveLength(1);
  });

  it("resolves a direct nvm default alias to its bin dir", async () => {
    const nvmDir = path.join(home, ".nvm");
    const binDir = path.join(nvmDir, "versions", "node", "v22.20.0", "bin");
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin:/bin", stderr: "" });
    mockExistsSync.mockImplementation((p: string) => [nvmDir, binDir].includes(p));
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === path.join(nvmDir, "alias", "default")) return "v22.20.0\n";
      throw new Error("ENOENT");
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === binDir) return { isDirectory: () => true };
      throw new Error("ENOENT");
    });

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(process.env.PATH?.startsWith(binDir)).toBe(true);
  });

  it("resolves an indirect nvm alias (e.g. lts/iron -> v20.x)", async () => {
    const nvmDir = path.join(home, ".nvm");
    const binDir = path.join(nvmDir, "versions", "node", "v20.19.0", "bin");
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin:/bin", stderr: "" });
    mockExistsSync.mockImplementation((p: string) => [nvmDir, binDir].includes(p));
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === path.join(nvmDir, "alias", "default")) return "lts/iron\n";
      if (p === path.join(nvmDir, "alias", "lts/iron")) return "v20.19.0\n";
      throw new Error("ENOENT");
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === binDir) return { isDirectory: () => true };
      throw new Error("ENOENT");
    });

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(process.env.PATH?.startsWith(binDir)).toBe(true);
  });

  it("uses $NVM_DIR env var when set", async () => {
    const nvmDir = "/custom/nvm";
    process.env.NVM_DIR = nvmDir;
    const binDir = path.join(nvmDir, "versions", "node", "v18.0.0", "bin");
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin:/bin", stderr: "" });
    mockExistsSync.mockImplementation((p: string) => [nvmDir, binDir].includes(p));
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === path.join(nvmDir, "alias", "default")) return "v18.0.0\n";
      throw new Error("ENOENT");
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === binDir) return { isDirectory: () => true };
      throw new Error("ENOENT");
    });

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(process.env.PATH?.startsWith(binDir)).toBe(true);
  });

  it("spawns the shell specified by $SHELL", async () => {
    process.env.SHELL = "/usr/bin/zsh";
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin:/bin", stderr: "" });
    mockDirs();

    const { fixPath } = await import("./fix-path");
    fixPath();

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "/usr/bin/zsh",
      expect.any(Array),
      expect.any(Object),
    );
  });
});
