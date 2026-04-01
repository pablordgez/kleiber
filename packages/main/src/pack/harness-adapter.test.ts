import { describe, expect, it } from "vitest";
import type { AgentPackConfig } from "@kleiber/shared";

import { resolveHarnessAdapter, tryResolveHarnessAdapter } from "./harness-adapter";

const config: AgentPackConfig = {
  version: 1,
  providers: {
    allowed: ["openai"],
    disallowed: [],
  },
  models: {
    defaults: {
      low_complexity: { provider: "openai", model: "mini" },
      medium_complexity: { provider: "openai", model: "medium" },
      high_complexity: { provider: "openai", model: "large" },
    },
    notes: [],
  },
  harness_adapters: {
    codex: {
      enabled: true,
      launch_command: "codex",
      orchestration: "native_subagents",
      yolo_flag: "--yolo",
      mcp_injection: "argv",
    },
    claude_code: {
      enabled: false,
      launch_command: "claude",
      orchestration: "plugin_or_manual",
    },
  },
  mcp: {
    available: [],
    notes: [],
  },
  agent_overrides: {
    claude_code: {
      yoloFlag: "-y",
      mcpInjection: "env",
    },
  },
};

describe("harness adapter resolution", () => {
  it("resolves adapter data by harness key", () => {
    expect(resolveHarnessAdapter(config, "codex")).toEqual({
      harnessName: "codex",
      enabled: true,
      launchCommand: "codex",
      orchestration: "native_subagents",
      yoloFlag: "--yolo",
      mcpInjection: "argv",
    });
  });

  it("resolves adapter data by CLI launch command", () => {
    expect(resolveHarnessAdapter(config, "claude")).toEqual({
      harnessName: "claude_code",
      enabled: false,
      launchCommand: "claude",
      orchestration: "plugin_or_manual",
      yoloFlag: "-y",
      mcpInjection: "env",
    });
  });

  it("returns null for unknown harnesses", () => {
    expect(tryResolveHarnessAdapter(config, "gemini")).toBeNull();
  });
});
