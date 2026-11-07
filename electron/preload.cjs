const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapshotHost', {
	selectRetailFolder: () => ipcRenderer.invoke('snapshot:select-retail-folder'),
	readAccount: (accountName) => ipcRenderer.invoke('snapshot:read-account', accountName),
	readIcon: (iconPath) => ipcRenderer.invoke('snapshot:read-icon', iconPath),
});
