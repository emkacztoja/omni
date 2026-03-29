import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { upsertFileChunks, deleteFileChunks, isAlreadyIndexed } from './db';
import { generateTags } from './ollama';
import { parsePDF, parseImage } from './ingest';
import { sendIngestProgress } from './main';

let currentWatcher: chokidar.FSWatcher | null = null;
let watchRoot: string = '';

export async function startWatching(dirPath: string) {
  watchRoot = dirPath;
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
    const ext = path.extname(filePath).toLowerCase();
    const valid = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg'];
    if (valid.includes(ext)) {
      await deleteFileChunks(filePath);
    }
  });
}

async function processFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const valid = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg'];
  if (!valid.includes(ext)) return;

  try {
    const stat = fs.statSync(filePath);

    // Skip if already indexed with exact same modification time
    if (await isAlreadyIndexed(filePath, stat.mtimeMs)) {
      return;
    }

    let text = '';

    if (ext === '.md' || ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf-8');
      
      // Auto-Tagging Check (only for markdown files without frontmatter)
      if (ext === '.md' && !text.startsWith('---\n') && text.trim().length > 10) {
        const tags = await generateTags(text);
        if (tags.length > 0) {
          const yaml = `---\ntags: [${tags.join(', ')}]\n---\n\n`;
          fs.writeFileSync(filePath, yaml + text);
          console.log(`[Omni] Auto-Tagged: ${path.basename(filePath)} -> [${tags.join(', ')}]`);
          return;
        }
      }
    } else if (ext === '.pdf') {
      const relPath = path.relative(watchRoot, filePath);
      sendIngestProgress(relPath, 20, 'Parsing PDF...');
      text = await parsePDF(filePath);
    } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      const relPath = path.relative(watchRoot, filePath);
      sendIngestProgress(relPath, 0, 'Starting OCR...');
      text = await parseImage(filePath, (prog, status) => {
        sendIngestProgress(relPath, prog, status);
      });
    }

    if (text.trim().length > 0) {
      const isMarkdown = ext === '.md' || ext === '.txt';
      const relPath = path.relative(watchRoot, filePath);
      const prefix = isMarkdown ? '' : `[File: ${path.basename(filePath)}]\n[Content follows]`;
      sendIngestProgress(relPath, 90, 'Indexing...');
      await upsertFileChunks(filePath, text, stat.mtimeMs, prefix);
      sendIngestProgress(relPath, 100, 'Complete');
      console.log(`[Omni] Ingested ${ext}: ${relPath}`);
      
      setTimeout(() => sendIngestProgress(relPath, -1, ''), 3000);
    }
  } catch (err) {
    const relPath = path.relative(watchRoot, filePath);
    console.error(`[Omni] Error processing file ${filePath}:`, err);
    sendIngestProgress(relPath, -1, 'Error');
  }
}
