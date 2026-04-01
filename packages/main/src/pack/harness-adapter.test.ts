import assert from "node:assert/strict";
import test from "node:test";

import type { AgentPackConfig } from "@kleiber/shared";
import {
  resolveHarnessAdapter,
  resolveLaunchCommand,
  resolveMcpInjectionMethod,
  resolveYoloFlag,
} from "./harness-adapter";

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
    codex: {
      yolo_flag: "--yolo",
      mcp_injection: "argv",
    },
    claude_code: {
      yoloFlag: "-y",
      mcpInjection: "env",
    },
  },
};

test("resolves adapter data without hardcoded harness branching", () => {
  assert.deepEqual(resolveHarnessAdapter(config, "codex"), {
    harnessName: "codex",
    enabled: true,
    launchCommand: "codex",
    orchestration: "native_subagents",
    yoloFlag: "--yolo",
    mcpInjection: "argv",
  });
});

test("resolves alias override keys for yolo and mcp injection", () => {
  assert.equal(resolveLaunchCommand(config, "claude_code"), "claude");
  assert.equal(resolveYoloFlag(config, "claude_code"), "-y");
  assert.equal(resolveMcpInjectionMethod(config, "claude_code"), "env");
});

test("returns nulls when the harness adapter is missing", () => {
  assert.deepEqual(resolveHarnessAdapter(config, "gemini_cli"), {
    harnessName: "gemini_cli",
    enabled: false,
    launchCommand: null,
    orchestration: null,
    yoloFlag: null,
    mcpInjection: null,
  });
});
