const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recap", {
  displays: () => ipcRenderer.invoke("displays"),
  start: (opts) => ipcRenderer.send("start", opts),
  discard: () => ipcRenderer.send("discard"),
  control: (action) => ipcRenderer.send("control", action),
  retryUpload: () => ipcRenderer.send("retry-upload"),
  recorder: (ev) => ipcRenderer.send("recorder", ev),
  chunk: (buf) => ipcRenderer.send("chunk", buf),
  open: (what) => ipcRenderer.send("open", what),
  copy: (text) => ipcRenderer.send("copy", text),
  requestState: () => ipcRenderer.send("state?"),
  hasToken: () => ipcRenderer.invoke("token:has"),
  setToken: (token) => ipcRenderer.invoke("token:set", token),
  checkConnection: (server) => ipcRenderer.invoke("connection:check", server),
  openLibrary: (pathname) => ipcRenderer.send("library", pathname),
  retryModel: () => ipcRenderer.send("model:retry"),
  setStorage: (server) => ipcRenderer.send("storage", server),
  on: (channel, fn) => {
    if (!["state", "begin", "control", "hotkey"].includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
