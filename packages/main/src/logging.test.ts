import assert from "node:assert/strict";
import test from "node:test";

import { buildRotatedLogPath, formatSecurityEvent } from "./logging";

test("formatSecurityEvent uses the security template", () => {
  assert.equal(
    formatSecurityEvent({
      action: "remote-api-bind",
      actor: "main-process",
      outcome: "allowed",
      scope: "local",
    }),
    "[security] action=remote-api-bind actor=main-process outcome=allowed scope=local",
  );
});

test("getRotatedLogPath produces numbered rotation paths", () => {
  assert.equal(buildRotatedLogPath("/tmp/main.log", 3), "/tmp/main.log.3");
});
