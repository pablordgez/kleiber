import path from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@kleiber/shared": path.resolve(__dirname, "packages/shared/src"),
      },
    },
    build: {
      outDir: "dist/main",
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, "packages/main/src/index.ts"),
        // `ws` probes these native addons behind try/catch; they should stay optional.
        external: ["bufferutil", "utf-8-validate"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@kleiber/shared": path.resolve(__dirname, "packages/shared/src"),
      },
    },
    build: {
      outDir: "dist/preload",
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, "packages/preload/src/index.ts"),
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, "packages/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@renderer": path.resolve(__dirname, "packages/renderer/src"),
        "@kleiber/shared": path.resolve(__dirname, "packages/shared/src"),
      },
    },
    build: {
      outDir: path.resolve(__dirname, "dist/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, "packages/renderer/index.html"),
      },
    },
  },
});
