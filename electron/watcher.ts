import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { upsertFileChunks, deleteFileChunks, isAlreadyIndexed } from './db';
import { generateTags } from './ollama';
import { parsePDF, parseImage } from './ingest';
import { sendIngestProgress } from './main';

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
      sendIngestProgress(filePath, 20, 'Parsing PDF...');
      text = await parsePDF(filePath);
    } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      sendIngestProgress(filePath, 0, 'Starting OCR...');
      text = await parseImage(filePath, (prog, status) => {
        sendIngestProgress(filePath, prog, status);
      });
    }

    if (text.trim().length > 0) {
      const isMarkdown = ext === '.md' || ext === '.txt';
      const prefix = isMarkdown ? '' : `[File: ${path.basename(filePath)}]\n[Content follows]`;
      sendIngestProgress(filePath, 90, 'Indexing...');
      await upsertFileChunks(filePath, text, stat.mtimeMs, prefix);
      sendIngestProgress(filePath, 100, 'Complete');
      console.log(`[Omni] Ingested ${ext}: ${path.basename(filePath)}`);
      
      setTimeout(() => sendIngestProgress(filePath, -1, ''), 3000);
    }
  } catch (err) {
    console.error(`[Omni] Error processing file ${filePath}:`, err);
    sendIngestProgress(filePath, -1, 'Error');
  }
}
