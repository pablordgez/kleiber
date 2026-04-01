import type { AgentPackConfig } from "@kleiber/shared";

type YamlScalar = string | number | boolean | null;
type YamlValue = YamlScalar | YamlObject | YamlArray;
type YamlObject = Record<string, YamlValue>;
type YamlArray = YamlValue[];

interface YamlLine {
  indent: number;
  content: string;
}

export function parseAgentPackConfigYaml(content: string): AgentPackConfig {
  const parsed = parseYamlDocument(content);
  return coerceAgentPackConfig(parsed);
}

function parseYamlDocument(content: string): YamlObject {
  const lines = normalizeLines(content);
  const [value, nextIndex] = parseObject(lines, 0, 0);
  if (nextIndex !== lines.length) {
    throw new Error("Unexpected trailing content in YAML document.");
  }
  return value;
}

function normalizeLines(content: string): YamlLine[] {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => stripInlineComment(line))
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = line.match(/^ */u);
      const indent = match ? match[0].length : 0;
      if (indent % 2 !== 0) {
        throw new Error("YAML parser only supports 2-space indentation.");
      }
      return {
        indent,
        content: line.slice(indent).trimEnd(),
      };
    });

  return lines;
}

function stripInlineComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      const prev = index === 0 ? " " : line[index - 1];
      if (/\s/u.test(prev)) {
        return line.slice(0, index).trimEnd();
      }
    }
  }

  return line;
}

function parseObject(lines: YamlLine[], startIndex: number, indent: number): [YamlObject, number] {
  const objectValue: YamlObject = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line index ${index}.`);
    }
    if (line.content.startsWith("- ")) {
      throw new Error(`Expected object entry at line index ${index}.`);
    }

    const separatorIndex = line.content.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid object entry at line index ${index}.`);
    }

    const key = line.content.slice(0, separatorIndex).trim();
    const rawValue = line.content.slice(separatorIndex + 1).trim();

    if (rawValue.length > 0) {
      objectValue[key] = parseScalar(rawValue);
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1];
    if (!nextLine || nextLine.indent <= indent) {
      objectValue[key] = {};
      index += 1;
      continue;
    }

    if (nextLine.content.startsWith("- ")) {
      const [arrayValue, nextIndex] = parseArray(lines, index + 1, indent + 2);
      objectValue[key] = arrayValue;
      index = nextIndex;
      continue;
    }

    const [nestedObject, nextIndex] = parseObject(lines, index + 1, indent + 2);
    objectValue[key] = nestedObject;
    index = nextIndex;
  }

  return [objectValue, index];
}

function parseArray(lines: YamlLine[], startIndex: number, indent: number): [YamlArray, number] {
  const values: YamlArray = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line index ${index}.`);
    }
    if (!line.content.startsWith("- ")) {
      break;
    }

    const rawValue = line.content.slice(2).trim();
    if (rawValue.length > 0) {
      values.push(parseScalar(rawValue));
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1];
    if (!nextLine || nextLine.indent <= indent) {
      values.push({});
      index += 1;
      continue;
    }

    if (nextLine.content.startsWith("- ")) {
      const [nestedArray, nextIndex] = parseArray(lines, index + 1, indent + 2);
      values.push(nestedArray);
      index = nextIndex;
      continue;
    }

    const [nestedObject, nextIndex] = parseObject(lines, index + 1, indent + 2);
    values.push(nestedObject);
    index = nextIndex;
  }

  return [values, index];
}

function parseScalar(rawValue: string): YamlValue {
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  if (rawValue === "null") {
    return null;
  }
  if (rawValue === "[]") {
    return [];
  }
  if (rawValue === "{}") {
    return {};
  }
  if (/^-?\d+$/u.test(rawValue)) {
    return Number.parseInt(rawValue, 10);
  }
  if (/^-?\d+\.\d+$/u.test(rawValue)) {
    return Number.parseFloat(rawValue);
  }
  if (
    (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function coerceAgentPackConfig(value: YamlObject): AgentPackConfig {
  const providers = expectObject(value, "providers");
  const models = expectObject(value, "models");
  const defaults = expectObject(expectObject(models, "defaults"), "low_complexity");
  void defaults;

  return {
    version: expectNumber(value, "version"),
    providers: {
      allowed: expectStringArray(providers, "allowed"),
      disallowed: expectStringArray(providers, "disallowed"),
    },
    models: {
      defaults: {
        low_complexity: coerceModelDefault(expectObject(expectObject(models, "defaults"), "low_complexity")),
        medium_complexity: coerceModelDefault(
          expectObject(expectObject(models, "defaults"), "medium_complexity"),
        ),
        high_complexity: coerceModelDefault(expectObject(expectObject(models, "defaults"), "high_complexity")),
      },
      notes: expectStringArray(models, "notes"),
    },
    harness_adapters: coerceHarnessAdapters(expectObject(value, "harness_adapters")),
    mcp: {
      available: expectStringArray(expectObject(value, "mcp"), "available"),
      notes: expectStringArray(expectObject(value, "mcp"), "notes"),
    },
    agent_overrides: expectObject(value, "agent_overrides"),
  };
}

function coerceModelDefault(value: YamlObject): { provider: string; model: string } {
  return {
    provider: expectString(value, "provider"),
    model: expectString(value, "model"),
  };
}

function coerceHarnessAdapters(value: YamlObject): AgentPackConfig["harness_adapters"] {
  return Object.entries(value).reduce<AgentPackConfig["harness_adapters"]>((accumulator, [name, adapter]) => {
    if (!isYamlObject(adapter)) {
      throw new Error(`Expected harness adapter "${name}" to be an object.`);
    }
    accumulator[name] = {
      enabled: expectBoolean(adapter, "enabled"),
      launch_command: expectString(adapter, "launch_command"),
      orchestration: expectString(adapter, "orchestration"),
    };
    return accumulator;
  }, {});
}

function expectObject(source: YamlObject, key: string): YamlObject {
  const value = source[key];
  if (!isYamlObject(value)) {
    throw new Error(`Expected "${key}" to be an object.`);
  }
  return value;
}

function expectNumber(source: YamlObject, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected "${key}" to be a number.`);
  }
  return value;
}

function expectBoolean(source: YamlObject, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected "${key}" to be a boolean.`);
  }
  return value;
}

function expectString(source: YamlObject, key: string): string {
  const value = source[key];
  if (typeof value !== "string") {
    throw new Error(`Expected "${key}" to be a string.`);
  }
  return value;
}

function expectStringArray(source: YamlObject, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected "${key}" to be an array of strings.`);
  }
  return value;
}

function isYamlObject(value: YamlValue | undefined): value is YamlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
