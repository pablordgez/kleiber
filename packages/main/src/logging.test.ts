import { expect, it } from "vitest";

import { buildRotatedLogPath, formatSecurityEvent } from "./logging";

it("formatSecurityEvent uses the security template", () => {
  expect(
    formatSecurityEvent({
      action: "remote-api-bind",
      actor: "main-process",
      outcome: "allowed",
      scope: "local",
    }),
  ).toBe("[security] action=remote-api-bind actor=main-process outcome=allowed scope=local");
});

it("getRotatedLogPath produces numbered rotation paths", () => {
  expect(buildRotatedLogPath("/tmp/main.log", 3)).toBe("/tmp/main.log.3");
});
