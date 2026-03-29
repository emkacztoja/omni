import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { initDB, searchContext, getGraphData } from './db';
import { startWatching } from './watcher';
import { chatStream, getLocalModels } from './ollama';
import { loadSettings, saveSettings } from './settings';
import fs from 'fs';

const defaultVault = path.join(app.getPath('documents'), 'Omni_Vault');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#121212',
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  createWindow();

  // Initialize Backend Features
  await initDB();
  await startWatching(defaultVault);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handers
ipcMain.handle('ping', () => 'pong');

ipcMain.handle('save-to-vault', async (event, filename: string, content: string) => {
  try {
    const filePath = path.join(defaultVault, filename);
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true, filePath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-vault-files', async () => {
  try {
    const files = await fs.promises.readdir(defaultVault);
    const valid = files.filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    const stats = await Promise.all(valid.map(async (file) => {
      const st = await fs.promises.stat(path.join(defaultVault, file));
      return { name: file, size: st.size, mtime: st.mtimeMs };
    }));
    return stats.sort((a,b) => b.mtime - a.mtime);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('delete-vault-file', async (event, filename: string) => {
  try {
    await fs.promises.unlink(path.join(defaultVault, filename));
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('open-vault-file', async (event, filename: string) => {
  try {
    await shell.openPath(path.join(defaultVault, filename));
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => saveSettings(settings));
ipcMain.handle('get-ollama-models', async () => await getLocalModels());
ipcMain.handle('get-graph-data', async () => await getGraphData());

ipcMain.handle('search-and-chat', async (event, history: {role: 'user' | 'assistant' | 'system', content: string}[], targetFile?: string) => {
  try {
    // 1. Semantic Search using the latest query
    const userQuery = history.reverse().find(m => m.role === 'user')?.content || '';
    const contextMeta = await searchContext(userQuery, 5, targetFile);
    const contextContent = contextMeta.map(m => `[From ${path.basename(m.filePath)}]:\n${m.content}`);
    
    // Send citations to renderer before starting chat
    const citations = Array.from(new Set(contextMeta.map(m => m.filePath)));
    event.sender.send('chat-citations', citations);

    // 2. Chat Synthesis (Stream)
    await chatStream(history, contextContent, (chunk) => {
      event.sender.send('chat-chunk', chunk);
    });

    event.sender.send('chat-complete');
    return true;
  } catch (error: any) {
    console.error("Chat error:", error);
    event.sender.send('chat-error', error.message || String(error));
    return false;
  }
});
