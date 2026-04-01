import { describe, expect, it } from "vitest";

import { parseAgentPackConfigYaml } from "./agent-pack-config";

const EXAMPLE_CONFIG = `version: 1
providers:
  allowed:
    - openai
    - anthropic
    - google
  disallowed: []
models:
  defaults:
    low_complexity:
      provider: openai
      model: gpt-5.4-mini
    medium_complexity:
      provider: anthropic
      model: claude-sonnet
    high_complexity:
      provider: openai
      model: gpt-5.4
  notes:
    - Prefer faster, cheaper models for scoped work.
harness_adapters:
  codex:
    enabled: true
    orchestration: native_subagents
    launch_command: codex
    yolo_flag: --yolo
    mcp_injection: argv
mcp:
  available: []
  notes:
    - No cross-harness MCP adapters configured.
agent_overrides: {}
`;

describe("parseAgentPackConfigYaml", () => {
  it("parses the expected schema", () => {
    const parsed = parseAgentPackConfigYaml(EXAMPLE_CONFIG);

    expect(parsed.version).toBe(1);
    expect(parsed.providers.allowed).toEqual(["openai", "anthropic", "google"]);
    expect(parsed.models.defaults.low_complexity.model).toBe("gpt-5.4-mini");
    expect(parsed.harness_adapters.codex?.enabled).toBe(true);
    expect(parsed.harness_adapters.codex?.yolo_flag).toBe("--yolo");
  });

  it("throws for invalid fields", () => {
    expect(() =>
      parseAgentPackConfigYaml(`version: "one"
providers:
  allowed: []
  disallowed: []
models:
  defaults:
    low_complexity:
      provider: openai
      model: gpt-5.4-mini
    medium_complexity:
      provider: openai
      model: gpt-5.4
    high_complexity:
      provider: openai
      model: gpt-5.4
  notes: []
harness_adapters: {}
mcp:
  available: []
  notes: []
agent_overrides: {}
`),
    ).toThrow(/version/);
  });
});
