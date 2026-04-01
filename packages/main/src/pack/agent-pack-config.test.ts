import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAgentPackConfigYaml } from "./agent-pack-config";

const EXAMPLE_CONFIG = `# Copy this file to .agent_specs/agent_pack_config.yaml and customize it.
version: 1

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

mcp:
  available: []
  notes:
    - No cross-harness MCP adapters configured.

agent_overrides: {}
`;

test("parseAgentPackConfigYaml parses the expected schema", () => {
  const parsed = parseAgentPackConfigYaml(EXAMPLE_CONFIG);

  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.providers.allowed, ["openai", "anthropic", "google"]);
  assert.equal(parsed.models.defaults.low_complexity.model, "gpt-5.4-mini");
  assert.equal(parsed.harness_adapters.codex.enabled, true);
  assert.deepEqual(parsed.mcp.available, []);
  assert.deepEqual(parsed.agent_overrides, {});
});

test("parseAgentPackConfigYaml throws for invalid fields", () => {
  assert.throws(
    () =>
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
    /version/u,
  );
});
