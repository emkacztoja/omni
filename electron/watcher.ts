import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { upsertFileChunks, deleteFileChunks } from './db';
import { generateTags } from './ollama';

let currentWatcher: chokidar.FSWatcher | null = null;

export async function startWatching(dirPath: string) {
  if (currentWatcher) {
    await currentWatcher.close();
  }

  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch { }

  currentWatcher = chokidar.watch(dirPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
  });

  currentWatcher.on('add', async (filePath: string) => processFile(filePath));
  currentWatcher.on('change', async (filePath: string) => processFile(filePath));
  currentWatcher.on('unlink', async (filePath: string) => {
    if (filePath.endsWith('.md') || filePath.endsWith('.txt')) {
      await deleteFileChunks(filePath);
    }
  });
}

async function processFile(filePath: string) {
  if (!filePath.endsWith('.md') && !filePath.endsWith('.txt')) return;

  try {
    const stat = fs.statSync(filePath);
    const text = fs.readFileSync(filePath, 'utf-8');

    // Auto-Tagging Check (only for files without frontmatter)
    if (!text.startsWith('---\n') && text.trim().length > 10) {
      const tags = await generateTags(text);
      if (tags.length > 0) {
        const yaml = `---\ntags: [${tags.join(', ')}]\n---\n\n`;
        // Prepend to file; this physical disk write will inherently trigger chokidar's 'change' event
        // The file will loop back through here naturally with its new tags!
        fs.writeFileSync(filePath, yaml + text);
        console.log(`[Omni] Auto-Tagged: ${path.basename(filePath)} -> [${tags.join(', ')}]`);
        return;
      }
    }

    await upsertFileChunks(filePath, text, stat.mtimeMs);
    console.log(`[Omni] Ingested file: ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[Omni] Error processing file ${filePath}:`, err);
  }
}
