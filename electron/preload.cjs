const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapshotHost', {
	selectGameFolder: () => ipcRenderer.invoke('snapshot:select-game-folder'),
	readAccount: (accountName) => ipcRenderer.invoke('snapshot:read-account', accountName),
	readIcon: (iconPath) => ipcRenderer.invoke('snapshot:read-icon', iconPath),
});
