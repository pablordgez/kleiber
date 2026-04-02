import path from "node:path";
import { app, BrowserWindow, Menu, session as electronSession } from "electron";
import { configureMainLogging, startSecurityEventLogging } from "./logging";
import { registerIpcHandlers } from "./ipc/handlers";
import { IPC_CHANNELS } from "@kleiber/shared";

configureMainLogging(process.env.NODE_ENV === "development");

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
  const menu = Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" as const }] : []),
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
