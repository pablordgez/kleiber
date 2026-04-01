import YAML from "yaml";
import type { AgentPackConfig, HarnessAdapter } from "@kleiber/shared";

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected "${label}" to be an object.`);
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected "${label}" to be a string.`);
  }

  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected "${label}" to be a number.`);
  }

  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected "${label}" to be a boolean.`);
  }

  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected "${label}" to be an array of strings.`);
  }

  return value;
}

function coerceHarnessAdapter(key: string, value: unknown): HarnessAdapter {
  const adapter = expectRecord(value, `harness_adapters.${key}`);
  const resolved: HarnessAdapter = {
    enabled: expectBoolean(adapter.enabled, `harness_adapters.${key}.enabled`),
    orchestration: expectString(adapter.orchestration, `harness_adapters.${key}.orchestration`),
    launch_command: expectString(adapter.launch_command, `harness_adapters.${key}.launch_command`),
  };

  if (typeof adapter.yolo_flag === "string") {
    resolved.yolo_flag = adapter.yolo_flag;
  }

  if (
    adapter.mcp_injection === "env" ||
    adapter.mcp_injection === "argv" ||
    adapter.mcp_injection === "stdio" ||
    adapter.mcp_injection === "none" ||
    adapter.mcp_injection === "unknown"
  ) {
    resolved.mcp_injection = adapter.mcp_injection;
  }

  return resolved;
}

export function parseAgentPackConfigYaml(content: string): AgentPackConfig {
  const parsed = YAML.parse(content) as unknown;
  const root = expectRecord(parsed, "root");
  const providers = expectRecord(root.providers, "providers");
  const models = expectRecord(root.models, "models");
  const defaults = expectRecord(models.defaults, "models.defaults");
  const mcp = expectRecord(root.mcp, "mcp");
  const harnessAdapters = expectRecord(root.harness_adapters, "harness_adapters");

  return {
    version: expectNumber(root.version, "version"),
    providers: {
      allowed: expectStringArray(providers.allowed, "providers.allowed"),
      disallowed: expectStringArray(providers.disallowed, "providers.disallowed"),
    },
    models: {
      defaults: {
        low_complexity: {
          provider: expectString(
            expectRecord(defaults.low_complexity, "models.defaults.low_complexity").provider,
            "models.defaults.low_complexity.provider",
          ),
          model: expectString(
            expectRecord(defaults.low_complexity, "models.defaults.low_complexity").model,
            "models.defaults.low_complexity.model",
          ),
        },
        medium_complexity: {
          provider: expectString(
            expectRecord(defaults.medium_complexity, "models.defaults.medium_complexity").provider,
            "models.defaults.medium_complexity.provider",
          ),
          model: expectString(
            expectRecord(defaults.medium_complexity, "models.defaults.medium_complexity").model,
            "models.defaults.medium_complexity.model",
          ),
        },
        high_complexity: {
          provider: expectString(
            expectRecord(defaults.high_complexity, "models.defaults.high_complexity").provider,
            "models.defaults.high_complexity.provider",
          ),
          model: expectString(
            expectRecord(defaults.high_complexity, "models.defaults.high_complexity").model,
            "models.defaults.high_complexity.model",
          ),
        },
      },
      notes: expectStringArray(models.notes, "models.notes"),
    },
    harness_adapters: Object.fromEntries(
      Object.entries(harnessAdapters).map(([key, value]) => [key, coerceHarnessAdapter(key, value)]),
    ),
    mcp: {
      available: expectStringArray(mcp.available, "mcp.available"),
      notes: expectStringArray(mcp.notes, "mcp.notes"),
    },
    agent_overrides: expectRecord(root.agent_overrides ?? {}, "agent_overrides"),
  };
}
