import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('ping'),
  getVaultFiles: () => ipcRenderer.invoke('get-vault-files'),
  deleteVaultFile: (filename: string) => ipcRenderer.invoke('delete-vault-file', filename),
  openVaultFile: (filename: string) => ipcRenderer.invoke('open-vault-file', filename),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  getGraphData: () => ipcRenderer.invoke('get-graph-data'),
  saveToVault: (filename: string, content: string) => ipcRenderer.invoke('save-to-vault', filename, content),
  searchAndChat: (history: {role: string, content: string}[], targetFile?: string) => ipcRenderer.invoke('search-and-chat', history, targetFile),
  onChatChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('chat-chunk', (_event, chunk) => callback(chunk));
  },
  onChatCitations: (callback: (citations: string[]) => void) => {
    ipcRenderer.on('chat-citations', (_event, citations) => callback(citations));
  },
  onChatComplete: (callback: () => void) => {
    ipcRenderer.on('chat-complete', () => callback());
  },
  onChatError: (callback: (error: string) => void) => {
    ipcRenderer.on('chat-error', (_event, error) => callback(error));
  },
  removeChatListeners: () => {
    ipcRenderer.removeAllListeners('chat-chunk');
    ipcRenderer.removeAllListeners('chat-citations');
    ipcRenderer.removeAllListeners('chat-complete');
    ipcRenderer.removeAllListeners('chat-error');
  }
});
