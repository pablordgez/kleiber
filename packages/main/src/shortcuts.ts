import { IPC_CHANNELS } from "@kleiber/shared";

export type ShortcutInput = {
  key: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
};

export function getNonMacShortcutChannel(
  input: ShortcutInput,
  platform = process.platform,
): string | null {
  if (platform === "darwin") return null;
  if (!input.control || input.alt) return null;

  const key = input.key.toLowerCase();
  if (key === "n" && !input.shift) return IPC_CHANNELS.shortcuts.newProject;
  if (key === "t" && !input.shift) return IPC_CHANNELS.shortcuts.newSession;
  if (key === "t" && input.shift) return IPC_CHANNELS.shortcuts.newSubSession;
  if (key === "w" && !input.shift) return IPC_CHANNELS.shortcuts.killSession;
  if (key === "," && !input.shift) return IPC_CHANNELS.shortcuts.openSettings;

  return null;
}
