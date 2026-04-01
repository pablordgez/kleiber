export const APP_NAME = "Kleiber";
export const APP_VERSION = "0.0.0";

export const DEFAULT_REMOTE_API_BIND_ADDRESS = "0.0.0.0";
export const DEFAULT_REMOTE_API_PORT: number | null = null;
export const DEFAULT_REMOTE_API_START_PORT = 9100;

export const DEFAULT_THEME = "dark" as const;
export const DEFAULT_OUTPUT_BUFFER_SIZE = 1000;
export const GLOBAL_PACK_DETECTION_SKILL = "requirements-engineer";

export const SUPPORTED_AGENT_CLIS = ["claude", "codex", "opencode", "gemini"] as const;
export const HARNESS_NAMES = ["claude_code", "codex", "opencode", "gemini_cli"] as const;
