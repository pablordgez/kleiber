import type { McpToolSchema } from "@kleiber/shared";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const KLEIBER_MCP_SERVER_NAME = "kleiber-mcp-orchestrator";
export const KLEIBER_MCP_SERVER_VERSION = "0.0.0";

type JsonSchemaType = "object" | "string" | "boolean" | "integer";

export interface JsonSchema {
  type: JsonSchemaType;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: readonly string[];
  minLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export const SPAWN_SESSION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    project_id: { type: "string", minLength: 1 },
    cli: { type: "string", enum: ["claude", "codex", "opencode", "gemini"] },
    role: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    yolo: { type: "boolean" },
    working_dir: { type: "string", minLength: 1 },
  },
  required: ["cli"],
  additionalProperties: false,
};

export const SEND_TO_SESSION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    session_id: { type: "string", minLength: 1 },
    text: { type: "string" },
    submit: { type: "boolean" },
  },
  required: ["session_id", "text"],
  additionalProperties: false,
};

export const READ_SESSION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    session_id: { type: "string", minLength: 1 },
    lines: { type: "integer", minimum: 1, maximum: 1000 },
    format: { type: "string", enum: ["plain", "raw"] },
  },
  required: ["session_id"],
  additionalProperties: false,
};

export const LIST_SESSIONS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    project_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

export const KILL_SESSION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    session_id: { type: "string", minLength: 1 },
  },
  required: ["session_id"],
  additionalProperties: false,
};

export const LIST_AVAILABLE_ROLES_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const NOTIFY_PARENT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1 },
  },
  required: ["text"],
  additionalProperties: false,
};

export const WAIT_FOR_CHILD_NOTIFICATION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    child_session_id: { type: "string", minLength: 1 },
    timeout_ms: { type: "integer", minimum: 0, maximum: 300000 },
  },
  additionalProperties: false,
};

export const MCP_TOOL_DEFINITIONS: readonly McpToolSchema[] = [
  {
    name: "spawn_session",
    description: "Spawn a new sub-session under the calling session. Omit project_id to use the caller's project automatically.",
    inputSchema: SPAWN_SESSION_SCHEMA,
  },
  {
    name: "send_to_session",
    description: "Write input text to a running session in the current project. submit defaults to true and presses Enter for you.",
    inputSchema: SEND_TO_SESSION_SCHEMA,
  },
  {
    name: "read_session",
    description: "Read recent buffered terminal output from a session in the current project.",
    inputSchema: READ_SESSION_SCHEMA,
  },
  {
    name: "list_sessions",
    description: "List sessions in the calling session's project.",
    inputSchema: LIST_SESSIONS_SCHEMA,
  },
  {
    name: "kill_session",
    description: "Kill a session and all descendants within the current project.",
    inputSchema: KILL_SESSION_SCHEMA,
  },
  {
    name: "list_available_roles",
    description: "List the bundled kleiber-agents roles that can be used for role-based sub-sessions.",
    inputSchema: LIST_AVAILABLE_ROLES_SCHEMA,
  },
  {
    name: "notify_parent",
    description: "Send a status update from the current sub-session to its parent session.",
    inputSchema: NOTIFY_PARENT_SCHEMA,
  },
  {
    name: "wait_for_child_notification",
    description: "Wait for the next queued child notification or child-exit event for the current session.",
    inputSchema: WAIT_FOR_CHILD_NOTIFICATION_SCHEMA,
  },
] as const;

export function validateJsonSchema(schema: JsonSchema, value: unknown, path = "$"): JsonSchemaValidationResult {
  const errors: string[] = [];
  validateInto(schema, value, path, errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateInto(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  switch (schema.type) {
    case "object": {
      if (!isRecord(value)) {
        errors.push(`${path} must be an object.`);
        return;
      }

      const required = new Set(schema.required ?? []);
      for (const key of required) {
        if (!(key in value)) {
          errors.push(`${path}.${key} is required.`);
        }
      }

      const properties = schema.properties ?? {};
      for (const [key, entry] of Object.entries(value)) {
        const propertySchema = properties[key];
        if (!propertySchema) {
          if (schema.additionalProperties === false) {
            errors.push(`${path}.${key} is not allowed.`);
          }
          continue;
        }
        validateInto(propertySchema, entry, `${path}.${key}`, errors);
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${path} must be a string.`);
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path} must contain at least ${String(schema.minLength)} characters.`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path} must be one of: ${schema.enum.join(", ")}.`);
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push(`${path} must be a boolean.`);
      }
      return;
    }
    case "integer": {
      if (!Number.isInteger(value)) {
        errors.push(`${path} must be an integer.`);
        return;
      }
      const integerValue = value as number;
      if (schema.minimum !== undefined && integerValue < schema.minimum) {
        errors.push(`${path} must be >= ${String(schema.minimum)}.`);
      }
      if (schema.maximum !== undefined && integerValue > schema.maximum) {
        errors.push(`${path} must be <= ${String(schema.maximum)}.`);
      }
      return;
    }
    default: {
      errors.push(`${path} uses an unsupported schema type.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
