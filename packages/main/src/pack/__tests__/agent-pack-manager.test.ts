import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { PRIMARY_BUNDLED_PACK_DIR } from "@kleiber/shared";
import { AgentPackManager } from "../agent-pack-manager";

// Mock node:fs/promises at the top level
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

import { access, readFile, readdir } from "node:fs/promises";

const mockAccess = access as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockReaddir = readdir as ReturnType<typeof vi.fn>;

const HOME = "/home/testuser";
const CWD = "/projects/myapp";
const PACK_ROOT = `/projects/myapp/${PRIMARY_BUNDLED_PACK_DIR}`;

describe("AgentPackManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("paths", () => {
    it("globalDetectionPath contains home directory and SKILL.md", () => {
      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      expect(mgr.globalDetectionPath).toContain(HOME);
      expect(mgr.globalDetectionPath).toContain("SKILL.md");
    });

    it("resolveProjectConfigPath returns path under .agent_specs", () => {
      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      const configPath = mgr.resolveProjectConfigPath(CWD);
      expect(configPath).toContain(".agent_specs");
      expect(configPath).toContain("agent_pack_config.yaml");
    });
  });

  describe("isGlobalInstallPresent", () => {
    it("returns true when detection path is accessible", async () => {
      mockAccess.mockResolvedValue(undefined);
      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      await expect(mgr.isGlobalInstallPresent()).resolves.toBe(true);
    });

    it("returns false when detection path is not accessible", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      await expect(mgr.isGlobalInstallPresent()).resolves.toBe(false);
    });
  });

  describe("discoverBundledRoles", () => {
    it("returns empty array when bundled skills path does not exist", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      await expect(mgr.discoverBundledRoles()).resolves.toEqual([]);
    });

    it("lists roles that have a SKILL.md file, sorted alphabetically", async () => {
      // readdir returns role-a first, then role-b.
      // access is called in Promise.all order (role-a, role-b).
      // role-a has SKILL.md; role-b does not.
      mockAccess
        .mockResolvedValueOnce(undefined) // bundledSkillsPath accessible
        .mockResolvedValueOnce(undefined) // role-a/SKILL.md exists
        .mockRejectedValueOnce(new Error("ENOENT")); // role-b/SKILL.md missing

      mockReaddir.mockResolvedValue([
        { name: "role-a", isDirectory: () => true },
        { name: "role-b", isDirectory: () => true },
        { name: "readme.txt", isDirectory: () => false },
      ]);

      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      const roles = await mgr.discoverBundledRoles();
      expect(roles).toEqual(["role-a"]);
    });

    it("excludes project-spec-utils from roles", async () => {
      mockAccess.mockResolvedValue(undefined); // everything accessible
      mockReaddir.mockResolvedValue([
        { name: "project-spec-utils", isDirectory: () => true },
        { name: "my-role", isDirectory: () => true },
      ]);

      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      const roles = await mgr.discoverBundledRoles();
      expect(roles).not.toContain("project-spec-utils");
      expect(roles).toContain("my-role");
    });

    it("returns roles sorted alphabetically", async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue([
        { name: "zebra-role", isDirectory: () => true },
        { name: "alpha-role", isDirectory: () => true },
        { name: "beta-role", isDirectory: () => true },
      ]);

      const mgr = new AgentPackManager({ homeDir: HOME, cwd: CWD, packRoot: PACK_ROOT });
      const roles = await mgr.discoverBundledRoles();
      expect(roles).toEqual(["alpha-role", "beta-role", "zebra-role"]);
    });
  });

  describe("installGlobal", () => {
    function makeFakeChild(exitCode = 0): ChildProcess {
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => cb(exitCode), 0);
          }
        }),
      };
      return child as unknown as ChildProcess;
    }

    it("uses array-form spawn (no shell: true)", async () => {
      const fakeChild = makeFakeChild(0);
      const spawnRunner = vi.fn(() => fakeChild);

      const mgr = new AgentPackManager({
        homeDir: HOME,
        cwd: CWD,
        packRoot: PACK_ROOT,
        spawnRunner: spawnRunner as any,
      });

      await mgr.installGlobal();

      expect(spawnRunner).toHaveBeenCalledOnce();
      const [, , spawnOptions] = spawnRunner.mock.calls[0] as [string, string[], Record<string, unknown>];
      expect(spawnOptions.shell).not.toBe(true);
    });

    it("passes command and args as separate arguments", async () => {
      const fakeChild = makeFakeChild(0);
      const spawnRunner = vi.fn(() => fakeChild);

      const mgr = new AgentPackManager({
        homeDir: HOME,
        cwd: CWD,
        packRoot: PACK_ROOT,
        spawnRunner: spawnRunner as any,
      });

      const result = await mgr.installGlobal();

      const [command, args] = spawnRunner.mock.calls[0] as [string, string[]];
      expect(typeof command).toBe("string");
      expect(Array.isArray(args)).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.command).toBe(command);
      expect(result.args).toBe(args);
    });

    it("returns exit code from child process", async () => {
      const fakeChild = makeFakeChild(1);
      const spawnRunner = vi.fn(() => fakeChild);

      const mgr = new AgentPackManager({
        homeDir: HOME,
        cwd: CWD,
        packRoot: PACK_ROOT,
        spawnRunner: spawnRunner as any,
      });

      const result = await mgr.installGlobal();
      expect(result.exitCode).toBe(1);
    });

    it("includes --copy flag when copy option is true", async () => {
      const fakeChild = makeFakeChild(0);
      const spawnRunner = vi.fn(() => fakeChild);

      const mgr = new AgentPackManager({
        homeDir: HOME,
        cwd: CWD,
        packRoot: PACK_ROOT,
        spawnRunner: spawnRunner as any,
      });

      await mgr.installGlobal({ copy: true });

      const [, args] = spawnRunner.mock.calls[0] as [string, string[]];
      expect(args).toContain("--copy");
    });
  });
});
