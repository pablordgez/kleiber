import type { AgentPackConfig, HarnessAdapter } from "@kleiber/shared";

export type HarnessInjectionMethod = NonNullable<HarnessAdapter["mcp_injection"]>;

export interface ResolvedHarnessAdapter {
  harnessName: string;
  enabled: boolean;
  launchCommand: string;
  orchestration: string;
  yoloFlag: string | null;
  mcpInjection: HarnessInjectionMethod | null;
}

function readOverrideString(
  config: AgentPackConfig,
  harnessName: string,
  keys: string[],
): string | null {
  const override = config.agent_overrides[harnessName];
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return null;
  }

  const entries = override as Record<string, unknown>;
  for (const key of keys) {
    if (typeof entries[key] === "string") {
      return entries[key];
    }
  }

  return null;
}

function resolveAdapterEntry(
  config: AgentPackConfig,
  identifier: string,
): [string, HarnessAdapter] | undefined {
  const direct = config.harness_adapters[identifier];
  if (direct) {
    return [identifier, direct];
  }

  return Object.entries(config.harness_adapters).find(
    ([, adapter]) => adapter.launch_command === identifier,
  );
}

export function tryResolveHarnessAdapter(
  config: AgentPackConfig,
  identifier: string,
): ResolvedHarnessAdapter | null {
  const entry = resolveAdapterEntry(config, identifier);
  if (!entry) {
    return null;
  }

  const [harnessName, adapter] = entry;
  return {
    harnessName,
    enabled: adapter.enabled,
    launchCommand: adapter.launch_command,
    orchestration: adapter.orchestration,
    yoloFlag: adapter.yolo_flag ?? readOverrideString(config, harnessName, ["yolo_flag", "yoloFlag"]),
    mcpInjection:
      adapter.mcp_injection ??
      ((readOverrideString(config, harnessName, ["mcp_injection", "mcpInjection"]) as HarnessInjectionMethod | null) ??
        null),
  };
}

export function resolveHarnessAdapter(
  config: AgentPackConfig,
  identifier: string,
): ResolvedHarnessAdapter {
  const resolved = tryResolveHarnessAdapter(config, identifier);
  if (!resolved) {
    throw new Error(`Unknown harness adapter or CLI: ${identifier}`);
  }

  return resolved;
}
