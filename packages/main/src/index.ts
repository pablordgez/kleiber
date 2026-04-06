import path from "node:path";
import { spawnSync } from "node:child_process";
import { app, BrowserWindow, Menu, session as electronSession } from "electron";
import log from "electron-log/main";
import { getNonMacShortcutChannel } from "./shortcuts";
import { configureMainLogging, startSecurityEventLogging } from "./logging";
import { registerIpcHandlers } from "./ipc/handlers";
import { IPC_CHANNELS } from "@kleiber/shared";

configureMainLogging(process.env.NODE_ENV === "development");

// When launched from a desktop environment (not a terminal), Electron inherits
// a minimal PATH that omits shell-configured directories such as npm/nvm/volta
// global bin paths. Spawn a login shell to retrieve the user's full PATH and
// apply it to the process before any binary detection happens.
if (process.platform !== "win32") {
  const shell = process.env.SHELL ?? "/bin/bash";
  log.info(`[path-fix] shell=${shell} inherited PATH=${process.env.PATH ?? "(unset)"}`);
  try {
    const result = spawnSync(shell, ["-l", "-c", "printf '%s' \"$PATH\""], {
      encoding: "utf8",
      timeout: 3000,
    });
    log.info(`[path-fix] spawn status=${String(result.status)} error=${String(result.error)} stderr=${result.stderr?.trim()}`);
    const shellPath = result.stdout?.trim();
    if (shellPath) {
      process.env.PATH = shellPath;
      log.info(`[path-fix] updated PATH=${shellPath}`);
    } else {
      log.warn("[path-fix] login shell returned empty PATH, keeping inherited value");
    }
  } catch (err) {
    log.warn(`[path-fix] failed to spawn login shell: ${String(err)}`);
  }
}

if (process.platform === "linux") {
  // Force the non-portal native dialog backend so directory pickers expose the
  // normal folder-creation affordances expected on Linux desktop environments.
  app.commandLine.appendSwitch("xdg-portal-required-version", "999");
}

function getContentSecurityPolicy(): string {
  const isDev = !!process.env.ELECTRON_RENDERER_URL;
  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws: wss: http: https:",
      "font-src 'self' data:",
    ].join("; ");
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
  ].join("; ");
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  startSecurityEventLogging(window.webContents);

  // Block navigation away from the app's own pages
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const isDev = !!process.env.ELECTRON_RENDERER_URL;
    if (isDev && (parsedUrl.hostname === "localhost" || parsedUrl.protocol === "file:")) return;
    if (!isDev && parsedUrl.protocol === "file:") return;
    event.preventDefault();
  });

  // Deny all new window creation (blocks window.open abuse)
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.webContents.on("before-input-event", (event, input) => {
    const shortcutChannel = getNonMacShortcutChannel(input);
    if (!shortcutChannel) return;
    event.preventDefault();
    window.webContents.send(shortcutChannel);
  });

  // Deny all permission requests (camera, mic, geolocation, etc.)
  window.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(false);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function buildAppMenu(): void {
  const sendToFocused = (channel: string) => {
    BrowserWindow.getFocusedWindow()?.webContents.send(channel);
  };

  const isMac = process.platform === "darwin";
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }

  const menu = Menu.buildFromTemplate([
    { role: "appMenu" as const },
    {
      label: "File",
      submenu: [
        {
          label: "New Project",
          accelerator: "CmdOrCtrl+N",
          click: () => sendToFocused(IPC_CHANNELS.shortcuts.newProject),
        },
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+T",
          click: () => sendToFocused(IPC_CHANNELS.shortcuts.newSession),
        },
        {
          label: "New Sub-Session",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => sendToFocused(IPC_CHANNELS.shortcuts.newSubSession),
        },
        {
          label: "Kill Session",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToFocused(IPC_CHANNELS.shortcuts.killSession),
        },
        { type: "separator" as const },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => sendToFocused(IPC_CHANNELS.shortcuts.openSettings),
        },
      ],
    },
    { role: "editMenu" as const },
    { role: "viewMenu" as const },
    { role: "windowMenu" as const },
  ]);

  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  registerIpcHandlers();
  buildAppMenu();

  // Set Content-Security-Policy on all responses
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [getContentSecurityPolicy()],
      },
    });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
