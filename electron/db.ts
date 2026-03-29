import { LocalIndex, TextSplitter } from 'vectra';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import crypto from 'crypto';
import { getEmbedding } from './ollama';

export interface ChunkMetadata {
  filePath: string;
  content: string;
  lastModified: number;
}

const indexFolder = path.join(app.getPath('userData'), 'omni_index');
if (!fs.existsSync(indexFolder)) {
  fs.mkdirSync(indexFolder, { recursive: true });
}

export const index = new LocalIndex(indexFolder);

class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise(resolve => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const dbMutex = new Mutex();

export async function initDB() {
  if (!await index.isIndexCreated()) {
    await index.createIndex({ version: 1, deleteIfExists: false });
  }
}

export async function upsertFileChunks(filePath: string, text: string, mtime: number) {
  const splitter = new TextSplitter({ chunkSize: 2000, chunkOverlap: 400 });
  const chunks = splitter.split(text).map(c => c.text);

  const release = await dbMutex.acquire();
  try {
    const allItems = await index.listItems();
    const existing = allItems.filter(item => (item.metadata as unknown as ChunkMetadata)?.filePath === filePath);
    
    await index.beginUpdate();
    for (const match of existing) {
      await index.deleteItem(match.id);
    }
  
    for (const content of chunks) {
      if (content.trim().length === 0) continue;
      try {
        const vector = await getEmbedding(content);
        await index.insertItem({
          id: crypto.randomUUID(),
          vector,
          metadata: { filePath, content, lastModified: mtime } as unknown as Record<string, string | number | boolean>
        });
      } catch (e) {
        console.error(`Failed to embed chunk of ${filePath}:`, e);
      }
    }
    await index.endUpdate();
  } finally {
    release();
  }
}

export async function searchContext(query: string, topK: number = 5, targetFile?: string): Promise<ChunkMetadata[]> {
  try {
    const queryVector = await getEmbedding(query);
    const filter = targetFile ? { filePath: targetFile } : undefined;
    const results = await index.queryItems(queryVector, query, topK, filter as any, true);
    return results.map(r => r.item.metadata as unknown as ChunkMetadata);
  } catch (e) {
    console.error('Search context failed:', e);
    return [];
  }
}

export async function deleteFileChunks(filePath: string) {
  const release = await dbMutex.acquire();
  try {
    const allItems = await index.listItems();
    const existing = allItems.filter(item => (item.metadata as unknown as ChunkMetadata)?.filePath === filePath);
    
    if (existing.length === 0) return;

    await index.beginUpdate();
    for (const match of existing) {
      await index.deleteItem(match.id);
    }
    await index.endUpdate();
    console.log(`[Omni] Purged ${existing.length} embeddings for: ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[Omni] Error purging file chunks for ${filePath}:`, err);
  } finally {
    release();
  }
}

export interface GraphData {
  nodes: { id: string; name: string; val: number }[];
  links: { source: string; target: string; value: number }[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProd = 0, sqA = 0, sqB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProd += a[i] * b[i];
    sqA += a[i] * a[i];
    sqB += b[i] * b[i];
  }
  return dotProd / (Math.sqrt(sqA) * Math.sqrt(sqB));
}

export async function getGraphData(): Promise<GraphData> {
  const allItems = await index.listItems();
  
  const fileVectors: Record<string, number[][]> = {};
  for (const item of allItems) {
    const meta = item.metadata as unknown as ChunkMetadata;
    if (!fileVectors[meta.filePath]) fileVectors[meta.filePath] = [];
    fileVectors[meta.filePath].push(item.vector);
  }

  const docEmbeddings: Record<string, number[]> = {};
  const fileNames = Object.keys(fileVectors);
  
  for (const file of fileNames) {
    const vectors = fileVectors[file];
    const avg = new Array(vectors[0].length).fill(0);
    for (const v of vectors) {
      for (let i = 0; i < v.length; i++) avg[i] += v[i];
    }
    for (let i = 0; i < avg.length; i++) avg[i] /= vectors.length;
    docEmbeddings[file] = avg;
  }

  const nodes = fileNames.map(f => ({ id: f, name: path.basename(f), val: fileVectors[f].length }));
  const links = [];

  for (let i = 0; i < fileNames.length; i++) {
    for (let j = i + 1; j < fileNames.length; j++) {
      const f1 = fileNames[i];
      const f2 = fileNames[j];
      const sim = cosineSimilarity(docEmbeddings[f1], docEmbeddings[f2]);
      if (sim > 0.6) { 
        links.push({ source: f1, target: f2, value: sim });
      }
    }
  }

  return { nodes, links };
}
