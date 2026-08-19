import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("vantageDesktop", {
  isDesktop: true,
  platform: process.platform,
});
