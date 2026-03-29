import { app, BrowserWindow, ipcMain, shell, globalShortcut } from 'electron';
import path from 'path';
import { initDB, searchContext, getGraphData } from './db';
import { startWatching } from './watcher';
import { chatStream, getLocalModels } from './ollama';
import { loadSettings, saveSettings } from './settings';
import fs from 'fs';

const defaultVault = path.join(app.getPath('documents'), 'Omni_Vault');
let mainWindow: BrowserWindow | null = null;
let searchWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

export function sendIngestProgress(filePath: string, progress: number, status: string) {
  if (mainWindow) {
    mainWindow.webContents.send('ingest-progress', { filePath, progress, status });
  }
}

function createSearchWindow() {
  searchWindow = new BrowserWindow({
    width: 700,
    height: 100, // Minimal height initially
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    searchWindow.loadURL('http://localhost:5173?search=true');
  } else {
    searchWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { search: 'true' } });
  }

  searchWindow.on('blur', () => {
    searchWindow?.hide();
  });

  searchWindow.on('closed', () => {
    searchWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();
  createSearchWindow();

  // Initialize Backend Features
  await initDB();
  await startWatching(defaultVault);

  // Global Shortcut
  globalShortcut.register('Control+Space', () => {
    if (searchWindow?.isVisible()) {
      searchWindow.hide();
    } else {
      searchWindow?.show();
      searchWindow?.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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
    const validExts = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg'];
    const valid = files.filter(f => validExts.includes(path.extname(f).toLowerCase()));
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

ipcMain.handle('read-vault-file', async (event, filename: string) => {
  try {
    const filePath = path.join(defaultVault, filename);
    const ext = path.extname(filePath).toLowerCase();
    
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      const buffer = await fs.promises.readFile(filePath);
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
    
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (e) { return null; }
});

ipcMain.handle('get-chat-history', async () => {
  try {
    const historyPath = path.join(app.getPath('userData'), 'chat_history.json');
    if (!fs.existsSync(historyPath)) return [];
    const data = await fs.promises.readFile(historyPath, 'utf-8');
    return JSON.parse(data);
  } catch (e) { return []; }
});

ipcMain.handle('save-chat-history', async (event, history) => {
  try {
    const historyPath = path.join(app.getPath('userData'), 'chat_history.json');
    await fs.promises.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8');
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => saveSettings(settings));
ipcMain.handle('get-ollama-models', async () => await getLocalModels());
ipcMain.handle('get-graph-data', async () => await getGraphData());

ipcMain.handle('resize-search-window', (event, height: number) => {
  searchWindow?.setSize(700, Math.min(height, 600)); // Cap at 600px
});

ipcMain.handle('search-and-chat', async (event, history: {role: 'user' | 'assistant' | 'system', content: string}[], targetFile?: string) => {
  try {
    // 1. Semantic Search using the latest query
    const userQuery = history.reverse().find(m => m.role === 'user')?.content || '';
    const contextMeta = await searchContext(userQuery, 5, targetFile);
    const contextContent = contextMeta.map(m => `[From ${path.basename(m.filePath)}]:\n${m.content}`);
    
    // Send detailed citations to renderer before starting chat
    const citations = contextMeta.map(m => ({
      filePath: m.filePath,
      content: m.content
    }));
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
