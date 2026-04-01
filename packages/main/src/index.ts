import path from "node:path";
import { app, BrowserWindow, session as electronSession } from "electron";
import { configureMainLogging, startSecurityEventLogging } from "./logging";

configureMainLogging(process.env.NODE_ENV === "development");

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

app.whenReady().then(() => {
  // Set Content-Security-Policy on all responses
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; font-src 'self';",
        ],
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
