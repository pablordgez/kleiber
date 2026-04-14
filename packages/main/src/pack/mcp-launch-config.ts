import type { AgentPackConfig } from "@kleiber/shared";

import type { McpLaunchConfig } from "../sessions/session-manager";

export interface McpRuntimeOptions {
  wrapperCommand: string;
  wrapperArgs: string[];
}

export function resolveAgentOverride(
  config: AgentPackConfig,
  harnessName: string,
): Record<string, unknown> {
  const entry = config.agent_overrides[harnessName];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {};
  }

  return entry as Record<string, unknown>;
}

export function resolveMcpLaunchConfig(
  injectionMethod: "env" | "argv" | "stdio" | "none" | "unknown" | null,
  override: Record<string, unknown>,
  runtime: McpRuntimeOptions | undefined,
): McpLaunchConfig | null {
  if (!runtime || !injectionMethod || injectionMethod === "none" || injectionMethod === "unknown") {
    return null;
  }

  const argsTemplate = readStringArrayOverride(override, ["mcp_args_template", "mcpArgsTemplate"]);
  const envTemplate = readStringRecordOverride(override, ["mcp_env_template", "mcpEnvTemplate"]) ?? {};
  const configContentTemplate =
    typeof override.mcp_config_content === "string"
      ? override.mcp_config_content
      : typeof override.mcpConfigContent === "string"
        ? override.mcpConfigContent
        : null;
  const configFileName =
    typeof override.mcp_config_file_name === "string"
      ? override.mcp_config_file_name
      : typeof override.mcpConfigFileName === "string"
        ? override.mcpConfigFileName
        : null;

  if (injectionMethod === "argv" && !argsTemplate) {
    return null;
  }

  return {
    injectionMethod,
    wrapperCommand: runtime.wrapperCommand,
    wrapperArgs: runtime.wrapperArgs,
    ...(argsTemplate ? { argsTemplate } : {}),
    envTemplate,
    ...(configContentTemplate ? { configContentTemplate } : {}),
    ...(configFileName ? { configFileName } : {}),
  };
}

function readStringArrayOverride(source: Record<string, unknown>, keys: string[]): string[] | null {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      return value as string[];
    }
  }

  return null;
}

function readStringRecordOverride(source: Record<string, unknown>, keys: string[]): Record<string, string> | null {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.every(([, entry]) => typeof entry === "string")) {
        return Object.fromEntries(entries) as Record<string, string>;
      }
    }
  }

  return null;
}
