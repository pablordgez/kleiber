import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "@kleiber/shared";
import { getNonMacShortcutChannel, type ShortcutInput } from "./shortcuts";

function shortcutInput(overrides: Partial<ShortcutInput> = {}): ShortcutInput {
  return {
    key: "",
    control: true,
    alt: false,
    shift: false,
    ...overrides,
  };
}

describe("getNonMacShortcutChannel", () => {
  it("maps supported non-mac shortcuts to IPC channels", () => {
    expect(getNonMacShortcutChannel(shortcutInput({ key: "n" }), "linux")).toBe(
      IPC_CHANNELS.shortcuts.newProject,
    );
    expect(getNonMacShortcutChannel(shortcutInput({ key: "T" }), "win32")).toBe(
      IPC_CHANNELS.shortcuts.newSession,
    );
    expect(getNonMacShortcutChannel(shortcutInput({ key: "t", shift: true }), "linux")).toBe(
      IPC_CHANNELS.shortcuts.newSubSession,
    );
    expect(getNonMacShortcutChannel(shortcutInput({ key: "w" }), "win32")).toBe(
      IPC_CHANNELS.shortcuts.killSession,
    );
    expect(getNonMacShortcutChannel(shortcutInput({ key: "," }), "linux")).toBe(
      IPC_CHANNELS.shortcuts.openSettings,
    );
  });

  it("does not match on macOS", () => {
    expect(getNonMacShortcutChannel(shortcutInput({ key: "n" }), "darwin")).toBeNull();
  });

  it("ignores shortcuts without ctrl or with alt", () => {
    expect(getNonMacShortcutChannel(shortcutInput({ key: "n", control: false }), "linux")).toBeNull();
    expect(getNonMacShortcutChannel(shortcutInput({ key: "n", alt: true }), "linux")).toBeNull();
  });
});
