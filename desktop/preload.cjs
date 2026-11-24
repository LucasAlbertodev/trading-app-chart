// What the desktop app's pages may ask the app itself (everything else goes through the built-in
// server): the network proxy setting, read and changed from Data sources (desktop/proxy.mjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wicklineDesktop', {
  getProxy: () => ipcRenderer.invoke('proxy:get'),
  setProxy: (settings) => ipcRenderer.invoke('proxy:set', { mode: settings?.mode, server: settings?.server }),
  // CFD en tiempo real (Capital.com): credenciales cifradas en la app, nunca en la página.
  getCapital: () => ipcRenderer.invoke('capital:get'),
  setCapital: (c) => ipcRenderer.invoke('capital:set', { env: c?.env, identifier: c?.identifier, apiKey: c?.apiKey, password: c?.password }),
  // CFD en tiempo real (OANDA): el token se guarda cifrado en la app, nunca en la página.
  getOanda: () => ipcRenderer.invoke('oanda:get'),
  setOanda: (cfg) => ipcRenderer.invoke('oanda:set', { env: cfg?.env, token: cfg?.token }),
  // Aceleración por GPU: Metal / Direct3D 11 / Vulkan / OpenGL / off.
  getGpu: () => ipcRenderer.invoke('gpu:get'),
  setGpu: (backend) => ipcRenderer.invoke('gpu:set', backend),
});
