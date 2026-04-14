import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { BUNDLED_PACK_DISPLAY_NAME, type AgentCli } from "@kleiber/shared";

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

function replaceLaunchTemplateValue(
  value: string,
  replacements: { role?: string | null; model?: string | null },
): string {
  let rendered = value;

  if (replacements.role !== undefined && replacements.role !== null) {
    rendered = rendered
      .replaceAll("{role}", replacements.role)
      .replaceAll("{roleJson}", JSON.stringify(replacements.role));
  }

  if (replacements.model !== undefined && replacements.model !== null) {
    rendered = rendered
      .replaceAll("{model}", replacements.model)
      .replaceAll("{modelJson}", JSON.stringify(replacements.model));
  }

  return rendered;
}

export function appendRoleLaunchArgs(
  args: string[],
  override: Record<string, unknown>,
  role: string,
): boolean {
  const roleFlag =
    typeof override.role_flag === "string"
      ? override.role_flag
      : typeof override.roleFlag === "string"
        ? override.roleFlag
        : null;
  if (roleFlag) {
    args.push(roleFlag, role);
    return true;
  }

  const roleTemplate = readStringArrayOverride(override, ["role_args_template", "roleArgsTemplate"]);
  if (roleTemplate) {
    args.push(...roleTemplate.map((entry) => replaceLaunchTemplateValue(entry, { role })));
    return true;
  }

  const roleAsPositional = override.role_as_positional === true || override.roleAsPositional === true;
  if (roleAsPositional) {
    args.push(role);
    return true;
  }

  return false;
}

export function appendModelLaunchArgs(
  args: string[],
  override: Record<string, unknown>,
  model: string,
): boolean {
  const modelFlag =
    typeof override.model_flag === "string"
      ? override.model_flag
      : typeof override.modelFlag === "string"
        ? override.modelFlag
        : null;
  if (modelFlag) {
    args.push(modelFlag, model);
    return true;
  }

  const modelTemplate = readStringArrayOverride(override, ["model_args_template", "modelArgsTemplate"]);
  if (modelTemplate) {
    args.push(...modelTemplate.map((entry) => replaceLaunchTemplateValue(entry, { model })));
    return true;
  }

  const modelAsPositional = override.model_as_positional === true || override.modelAsPositional === true;
  if (modelAsPositional) {
    args.push(model);
    return true;
  }

  return false;
}

export function resolveModelLaunchEnv(
  override: Record<string, unknown>,
  model: string | null,
): NodeJS.ProcessEnv {
  if (!model) {
    return {};
  }

  const envTemplate = readStringRecordOverride(override, ["model_env_template", "modelEnvTemplate"]);
  if (!envTemplate) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(envTemplate).map(([key, value]) => [key, replaceLaunchTemplateValue(value, { model })]),
  );
}

function buildAgentBootstrapPrompt(role: string, cli: AgentCli, mcpEnabled: boolean): string {
  const agentConfigPaths: Record<AgentCli, string> = {
    codex: `.codex/agents/${role}.toml`,
    claude: `.claude/agents/${role}.md`,
    gemini: `.gemini/agents/${role}.md`,
    opencode: `.opencode/agents/${role}.md`,
  };

  const agentConfigInstructions: Record<AgentCli, string> = {
    codex: "adopt its description and developer_instructions for this top-level session",
    claude: "adopt its system prompt and instructions for this top-level session",
    gemini: "adopt its system prompt and instructions for this top-level session",
    opencode: "adopt its system prompt and instructions for this top-level session",
  };

  const configPath = agentConfigPaths[cli] ?? `.agents/${role}.md`;
  const configInstruction = agentConfigInstructions[cli] ?? "adopt its instructions for this top-level session";

  return [
    `You are operating inside Kleiber as the ${role} role from ${BUNDLED_PACK_DISPLAY_NAME}.`,
    "Treat other kleiber-agents roles as peer specialists in the same ecosystem.",
    mcpEnabled
      ? "Kleiber session orchestration may be available in this session through the existing MCP tools."
      : "Kleiber session orchestration is disabled for this session, so do not assume MCP access.",
    "Distinguish Kleiber session orchestration from harness-native delegation features.",
    `Before doing anything else, read ${path.join(os.homedir(), ".agents", "skills", "project-spec-utils", "references", "kleiber-ecosystem.md")} if it exists, then read ${configPath} if it exists and ${configInstruction}.`,
    "If Kleiber orchestration or tool availability is uncertain, inspect local context and available capabilities before claiming support.",
    "Briefly state that the Kleiber agent context is loaded and wait for the user's task.",
  ].join(" ");
}

export async function resolveRoleBootstrap(
  role: string,
  cli: AgentCli,
  mcpEnabled: boolean,
): Promise<{ args: string[]; prompt?: string }> {
  const promptText = buildAgentBootstrapPrompt(role, cli, mcpEnabled);

  if (cli === "claude") {
    const promptDir = path.join(os.tmpdir(), "kleiber-bootstrap");
    await mkdir(promptDir, { recursive: true });
    const promptFile = path.join(promptDir, `${crypto.randomUUID()}.md`);
    await writeFile(promptFile, promptText, "utf8");
    return { args: [promptFile] };
  }

  return { args: [], prompt: promptText };
}
