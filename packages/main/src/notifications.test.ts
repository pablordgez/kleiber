import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  Notification: class {
    constructor(_options: { title: string; body: string }) {}
    show(): void {}
  },
}));

import { formatSessionExitStatus, notifySessionExitIfUnfocused } from "./notifications";

describe("notifications", () => {
  it("formats exit status from exit codes and signals", () => {
    expect(formatSessionExitStatus({ exitCode: 7, signal: null })).toBe("exit code 7");
    expect(formatSessionExitStatus({ exitCode: null, signal: "SIGTERM" })).toBe("signal SIGTERM");
    expect(formatSessionExitStatus({ exitCode: null, signal: null })).toBe("exited");
  });

  it("shows a notification only when no window is focused", () => {
    const show = vi.fn();
    const notificationCtor = vi.fn(() => ({ show }));

    const result = notifySessionExitIfUnfocused(
      { session: { name: "Session Alpha", exitCode: 1, signal: null } },
      [{ isFocused: () => false }],
      notificationCtor as any,
    );

    expect(result).toBe(true);
    expect(notificationCtor).toHaveBeenCalledWith({
      title: "Session exited: Session Alpha",
      body: "The session ended with exit code 1.",
    });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("skips notifications when any window is focused", () => {
    const notificationCtor = vi.fn();

    const result = notifySessionExitIfUnfocused(
      { session: { name: "Session Beta", exitCode: 0, signal: null } },
      [{ isFocused: () => true }],
      notificationCtor as any,
    );

    expect(result).toBe(false);
    expect(notificationCtor).not.toHaveBeenCalled();
  });
});
