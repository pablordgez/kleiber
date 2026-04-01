import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("kleiber", {
  appName: "Kleiber",
});
