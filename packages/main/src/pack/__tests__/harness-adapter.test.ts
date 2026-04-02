import { describe, it, expect } from "vitest";
import { tryResolveHarnessAdapter, resolveHarnessAdapter } from "../harness-adapter";
import type { AgentPackConfig } from "@kleiber/shared";

function makeConfig(overrides: Partial<AgentPackConfig> = {}): AgentPackConfig {
  return {
    version: 1,
    providers: { allowed: [], disallowed: [] },
    models: {
      defaults: {
        low_complexity: { provider: "openai", model: "gpt-4o-mini" },
        medium_complexity: { provider: "openai", model: "gpt-4o" },
        high_complexity: { provider: "anthropic", model: "claude-opus-4" },
      },
      notes: [],
    },
    harness_adapters: {
      claude: {
        enabled: true,
        launch_command: "claude",
        orchestration: "claude-code",
        yolo_flag: "--dangerously-skip-permissions",
        mcp_injection: "env",
      },
      codex: {
        enabled: true,
        launch_command: "codex",
        orchestration: "codex-cli",
        yolo_flag: "--full-auto",
        mcp_injection: "argv",
      },
    },
    mcp: { available: [], notes: [] },
    agent_overrides: {},
    ...overrides,
  };
}

describe("tryResolveHarnessAdapter", () => {
  it("resolves adapter by key name", () => {
    const config = makeConfig();
    const result = tryResolveHarnessAdapter(config, "claude");
    expect(result).not.toBeNull();
    expect(result?.harnessName).toBe("claude");
    expect(result?.launchCommand).toBe("claude");
  });

  it("resolves adapter by launch_command string", () => {
    const config = makeConfig();
    const result = tryResolveHarnessAdapter(config, "codex");
    expect(result?.harnessName).toBe("codex");
    expect(result?.launchCommand).toBe("codex");
  });

  it("returns null for an unknown identifier", () => {
    const config = makeConfig();
    expect(tryResolveHarnessAdapter(config, "unknown-cli")).toBeNull();
  });

  it("maps yoloFlag from adapter.yolo_flag", () => {
    const config = makeConfig();
    const result = tryResolveHarnessAdapter(config, "claude");
    expect(result?.yoloFlag).toBe("--dangerously-skip-permissions");
  });

  it("falls back to agent_overrides for yolo_flag when not on adapter", () => {
    const config = makeConfig({
      harness_adapters: {
        mytool: {
          enabled: true,
          launch_command: "mytool",
          orchestration: "custom",
          // no yolo_flag on adapter
        },
      },
      agent_overrides: {
        mytool: { yolo_flag: "--override-yolo" },
      },
    });
    const result = tryResolveHarnessAdapter(config, "mytool");
    expect(result?.yoloFlag).toBe("--override-yolo");
  });

  it("yoloFlag is null when neither adapter nor overrides define it", () => {
    const config = makeConfig({
      harness_adapters: {
        notool: {
          enabled: true,
          launch_command: "notool",
          orchestration: "custom",
        },
      },
    });
    const result = tryResolveHarnessAdapter(config, "notool");
    expect(result?.yoloFlag).toBeNull();
  });

  it("maps mcpInjection from adapter.mcp_injection", () => {
    const config = makeConfig();
    const result = tryResolveHarnessAdapter(config, "codex");
    expect(result?.mcpInjection).toBe("argv");
  });

  it("maps enabled flag from adapter", () => {
    const config = makeConfig({
      harness_adapters: {
        disabled_tool: {
          enabled: false,
          launch_command: "disabled_tool",
          orchestration: "none",
        },
      },
    });
    const result = tryResolveHarnessAdapter(config, "disabled_tool");
    expect(result?.enabled).toBe(false);
  });

  it("maps orchestration field from adapter", () => {
    const config = makeConfig();
    const result = tryResolveHarnessAdapter(config, "claude");
    expect(result?.orchestration).toBe("claude-code");
  });

  describe("adding a new CLI via config only", () => {
    it("resolves a brand new CLI added only via config — no code changes needed", () => {
      const config = makeConfig({
        harness_adapters: {
          ...makeConfig().harness_adapters,
          gemini: {
            enabled: true,
            launch_command: "gemini",
            orchestration: "gemini-cli",
            yolo_flag: "--yolo",
            mcp_injection: "stdio",
          },
        },
      });

      const result = tryResolveHarnessAdapter(config, "gemini");
      expect(result).not.toBeNull();
      expect(result?.harnessName).toBe("gemini");
      expect(result?.launchCommand).toBe("gemini");
      expect(result?.yoloFlag).toBe("--yolo");
      expect(result?.mcpInjection).toBe("stdio");
    });

    it("new CLI can be resolved by launch_command as well", () => {
      const config = makeConfig({
        harness_adapters: {
          new_tool_key: {
            enabled: true,
            launch_command: "/usr/local/bin/newtool",
            orchestration: "new-orchestration",
          },
        },
      });

      const result = tryResolveHarnessAdapter(config, "/usr/local/bin/newtool");
      expect(result?.harnessName).toBe("new_tool_key");
    });
  });
});

describe("resolveHarnessAdapter", () => {
  it("throws for an unknown identifier", () => {
    const config = makeConfig();
    expect(() => resolveHarnessAdapter(config, "nope")).toThrow(/Unknown harness adapter/);
  });

  it("returns the resolved adapter for a known identifier", () => {
    const config = makeConfig();
    const result = resolveHarnessAdapter(config, "claude");
    expect(result.enabled).toBe(true);
    expect(result.harnessName).toBe("claude");
  });
});
