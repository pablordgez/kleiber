import { Notification, type BrowserWindow } from "electron";

import type { Session } from "@kleiber/shared";

export interface NotificationLike {
  show(): void;
}

export interface NotificationConstructor {
  new (options: { title: string; body: string }): NotificationLike;
}

export interface SessionExitNotificationTarget {
  session: Pick<Session, "name" | "exitCode" | "signal">;
}

export function formatSessionExitStatus(session: Pick<Session, "exitCode" | "signal">): string {
  if (session.exitCode !== null && session.exitCode !== undefined) {
    return `exit code ${String(session.exitCode)}`;
  }

  if (session.signal !== null && session.signal !== undefined) {
    return `signal ${String(session.signal)}`;
  }

  return "exited";
}

export function notifySessionExitIfUnfocused(
  target: SessionExitNotificationTarget,
  windows: readonly Pick<BrowserWindow, "isFocused">[] = [],
  NotificationImpl: NotificationConstructor = Notification,
): boolean {
  const hasFocusedWindow = windows.some((window) => window.isFocused());
  if (hasFocusedWindow) {
    return false;
  }

  const status = formatSessionExitStatus(target.session);
  const notification = new NotificationImpl({
    title: `Session exited: ${target.session.name}`,
    body: `The session ended with ${status}.`,
  });
  notification.show();
  return true;
}
