import fs from "node:fs";
import path from "node:path";
import { app, type WebContents } from "electron";
import log from "electron-log/main";

export const LOG_ROTATION_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const LOG_ROTATION_MAX_FILES = 3;

type LogLevel = "error" | "warn" | "info" | "verbose" | "debug" | "silly";

export interface LoggingSnapshot {
  consoleLevel: LogLevel | false;
  fileLevel: LogLevel | false;
  fileMaxSize: number;
  filePath: string;
}

export interface SecurityEventDetails {
  actor?: string;
  action: string;
  outcome?: "allowed" | "blocked" | "failed";
  reason?: string;
  scope?: string;
}

export function getMainLogPath(): string {
  return path.join(app.getPath("userData"), "logs", "main.log");
}

export function getRotatedLogPath(index: number): string {
  return buildRotatedLogPath(getMainLogPath(), index);
}

export function buildRotatedLogPath(basePath: string, index: number): string {
  return `${basePath}.${index}`;
}

export function rotateMainLogFiles(): void {
  for (let index = LOG_ROTATION_MAX_FILES; index >= 1; index -= 1) {
    const sourcePath = index === 1 ? getMainLogPath() : getRotatedLogPath(index - 1);
    const targetPath = getRotatedLogPath(index);

    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    if (index === LOG_ROTATION_MAX_FILES && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }

    fs.renameSync(sourcePath, targetPath);
  }
}

export function formatSecurityEvent(details: SecurityEventDetails): string {
  const parts = [
    `action=${details.action}`,
    details.actor ? `actor=${details.actor}` : undefined,
    details.outcome ? `outcome=${details.outcome}` : undefined,
    details.scope ? `scope=${details.scope}` : undefined,
    details.reason ? `reason=${details.reason}` : undefined,
  ].filter(Boolean);

  return `[security] ${parts.join(" ")}`;
}

export function configureMainLogging(isDev: boolean): LoggingSnapshot {
  log.initialize();

  log.transports.console.level = isDev ? "debug" : "info";
  log.transports.file.level = "info";
  log.transports.file.maxSize = LOG_ROTATION_MAX_SIZE_BYTES;
  log.transports.file.resolvePathFn = getMainLogPath;
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
  log.transports.file.archiveLogFn = () => {
    rotateMainLogFiles();
  };
  app.on("certificate-error", (_, _webContents, url, error, _certificate, callback) => {
    logSecurityFailure("certificate-error", `${error} url=${url}`);
    callback(false);
  });
  app.on("child-process-gone", (_, details) => {
    logSecurityFailure(
      "child-process-gone",
      `${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  app.on("render-process-gone", (_, webContents, details) => {
    logSecurityFailure(
      "render-process-gone",
      `${details.reason} exitCode=${details.exitCode}`,
      `webContents:${webContents.id}`,
    );
  });

  return {
    consoleLevel: log.transports.console.level,
    fileLevel: log.transports.file.level,
    fileMaxSize: log.transports.file.maxSize ?? LOG_ROTATION_MAX_SIZE_BYTES,
    filePath: getMainLogPath(),
  };
}

export function logSecurityEvent(details: SecurityEventDetails): void {
  log.warn(formatSecurityEvent(details));
}

export function logSecurityFailure(action: string, reason: string, actor?: string): void {
  const details: SecurityEventDetails = {
    action,
    outcome: "failed",
    reason,
  };

  if (actor) {
    details.actor = actor;
  }

  logSecurityEvent(details);
}

export function logSecurityAccess(action: string, allowed: boolean, actor?: string): void {
  const details: SecurityEventDetails = {
    action,
    outcome: allowed ? "allowed" : "blocked",
  };

  if (actor) {
    details.actor = actor;
  }

  logSecurityEvent(details);
}

export function startSecurityEventLogging(webContents: WebContents): void {
  const label = `webContents:${webContents.id}`;

  webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logSecurityFailure(
      "web-contents-load-failed",
      `${errorCode}:${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`,
      label,
    );
  });

  webContents.on("render-process-gone", (_, details) => {
    logSecurityFailure("render-process-gone", `${details.reason} exitCode=${details.exitCode}`, label);
  });

  webContents.on("preload-error", (_, preloadPath, error) => {
    logSecurityFailure("preload-error", `${preloadPath} ${error.message}`, label);
  });
}
