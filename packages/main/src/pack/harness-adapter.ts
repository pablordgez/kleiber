import type { AgentPackConfig, HarnessAdapter, HarnessName } from "@kleiber/shared";

export type HarnessInjectionMethod = "env" | "argv" | "stdin" | "stdio" | "unknown";

export interface ResolvedHarnessAdapter extends HarnessAdapter {
  yolo_flag?: string | null;
  mcp_injection?: HarnessInjectionMethod | null;
}

export interface HarnessAdapterResolution {
  harnessName: HarnessName | string;
  enabled: boolean;
  launchCommand: string | null;
  orchestration: string | null;
  yoloFlag: string | null;
  mcpInjection: HarnessInjectionMethod | null;
}

type HarnessOverride = {
  yolo_flag?: string;
  yoloFlag?: string;
  mcp_injection?: HarnessInjectionMethod;
  mcpInjection?: HarnessInjectionMethod;
};

function readHarnessAdapter(config: AgentPackConfig, harnessName: HarnessName | string): ResolvedHarnessAdapter | null {
  const adapter = config.harness_adapters[harnessName];
  if (!adapter) {
    return null;
  }

  const overrides = config.agent_overrides[harnessName] as HarnessOverride | undefined;

  return {
    ...adapter,
    yolo_flag: overrides?.yolo_flag ?? overrides?.yoloFlag ?? null,
    mcp_injection: overrides?.mcp_injection ?? overrides?.mcpInjection ?? null,
  };
}

export function resolveHarnessAdapter(
  config: AgentPackConfig,
  harnessName: HarnessName | string,
): HarnessAdapterResolution {
  const adapter = readHarnessAdapter(config, harnessName);

  return {
    harnessName,
    enabled: adapter?.enabled ?? false,
    launchCommand: adapter?.launch_command ?? null,
    orchestration: adapter?.orchestration ?? null,
    yoloFlag: adapter?.yolo_flag ?? null,
    mcpInjection: adapter?.mcp_injection ?? null,
  };
}

export function resolveLaunchCommand(config: AgentPackConfig, harnessName: HarnessName | string): string | null {
  return resolveHarnessAdapter(config, harnessName).launchCommand;
}

export function resolveYoloFlag(config: AgentPackConfig, harnessName: HarnessName | string): string | null {
  return resolveHarnessAdapter(config, harnessName).yoloFlag;
}

export function resolveMcpInjectionMethod(
  config: AgentPackConfig,
  harnessName: HarnessName | string,
): HarnessInjectionMethod | null {
  return resolveHarnessAdapter(config, harnessName).mcpInjection;
}
