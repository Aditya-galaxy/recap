const { contextBridge, ipcRenderer } = require("electron");

// Lets the library open the desktop recorder and share videos through the operating system.
contextBridge.exposeInMainWorld("recapDesktop", {
  record: () => ipcRenderer.send("record-request"),
  platform: process.platform,
  /** action: "menu" (macOS share sheet) | "copy" (file to clipboard) | "folder" (show in Finder/Explorer) */
  share: (action, video) => ipcRenderer.invoke("share", { ...video, action }),
  /** Call from a dragstart handler: hands the OS a real file to drop into another app. */
  dragVideo: (video) => ipcRenderer.send("share:drag", video),
});
