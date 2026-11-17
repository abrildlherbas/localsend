const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localsend', {
  info: () => ipcRenderer.invoke('app:info'),
  decide: (id, accepted) => ipcRenderer.invoke('transfer:decision', { id, accepted }),
  on: (channel, callback) => {
    const allowed = ['status', 'incoming', 'progress', 'complete'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_event, data) => callback(data));
  }
});
