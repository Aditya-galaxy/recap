const { contextBridge, ipcRenderer } = require("electron");

// Lets the library's "record" button open the desktop recorder.
contextBridge.exposeInMainWorld("recapDesktop", {
  record: () => ipcRenderer.send("record-request"),
});
