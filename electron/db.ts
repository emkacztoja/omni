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
  tags?: string;  // Comma-separated string
  links?: string; // Comma-separated string
}

const indexFolder = path.join(app.getPath('userData'), 'omni_index');
if (!fs.existsSync(indexFolder)) {
  fs.mkdirSync(indexFolder, { recursive: true });
}

export const index = new LocalIndex(indexFolder);

function extractTagsAndLinks(text: string): { tags: string, links: string } {
  const tags: string[] = [];
  const links: string[] = [];

  // WikiLinks: [[filename]] or [[filename|label]]
  const wikiLinkRegex = /\[\[(.*?)\]\]/g;
  let match;
  while ((match = wikiLinkRegex.exec(text)) !== null) {
    const link = match[1].split('|')[0].trim();
    if (link) links.push(link);
  }

  // Tags: #tag (starting with # followed by alphanumeric)
  const tagRegex = /(?:^|\s)#([a-zA-Z0-9_-]+)/g;
  while ((match = tagRegex.exec(text)) !== null) {
    tags.push(match[1].toLowerCase());
  }

  // Also look for tags in YAML frontmatter if present
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/m;
  const fmMatch = text.match(frontmatterRegex);
  if (fmMatch) {
    const fmContent = fmMatch[1];
    const fmTagsMatch = fmContent.match(/tags:\s*\[(.*?)\]/);
    if (fmTagsMatch) {
      const fmTags = fmTagsMatch[1].split(',').map(t => t.trim().replace(/['"\[\]]/g, '').toLowerCase());
      tags.push(...fmTags);
    }
  }

  return { 
    tags: Array.from(new Set(tags)).join(','), 
    links: Array.from(new Set(links)).join(',') 
  };
}

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

export async function isAlreadyIndexed(filePath: string, mtime: number): Promise<boolean> {
  const allItems = await index.listItems();
  const existing = allItems.find(item => {
    const meta = item.metadata as unknown as ChunkMetadata;
    return meta.filePath === filePath && meta.lastModified === mtime;
  });
  return !!existing;
}

export async function upsertFileChunks(filePath: string, text: string, mtime: number, textPrefix: string = '') {
  const splitter = new TextSplitter({ chunkSize: 2000, chunkOverlap: 400 });
  const fullText = textPrefix ? `${textPrefix}\n\n${text}` : text;
  const chunks = splitter.split(fullText).map(c => c.text);
  const { tags, links } = extractTagsAndLinks(text); // Use raw text for tag extraction

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
          metadata: { 
            filePath, 
            content, 
            lastModified: mtime,
            tags,
            links
          } as unknown as Record<string, string | number | boolean>
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
    
    let results;
    try {
      // Try with hybrid search (BM25) first
      results = await index.queryItems(queryVector, query, topK, filter as any, true);
    } catch (bm25Error) {
      // Fallback to simple vector search if index is too small or other hybrid search errors
      console.warn('Hybrid search failed, falling back to vector-only search:', bm25Error);
      results = await index.queryItems(queryVector, query, topK, filter as any, false);
    }
    
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
  links: { source: string; target: string; value: number; type: 'similarity' | 'explicit' | 'tag' }[];
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
  const fileMetadata: Record<string, { tags: string[], links: string[] }> = {};

  for (const item of allItems) {
    const meta = item.metadata as unknown as ChunkMetadata;
    if (!fileVectors[meta.filePath]) {
      fileVectors[meta.filePath] = [];
      const tags = meta.tags ? meta.tags.split(',').filter(t => t.length > 0) : [];
      const links = meta.links ? meta.links.split(',').filter(l => l.length > 0) : [];
      fileMetadata[meta.filePath] = { tags, links };
    }
    fileVectors[meta.filePath].push(item.vector);
  }

  const docEmbeddings: Record<string, number[]> = {};
  const filePaths = Object.keys(fileVectors);
  
  for (const filePath of filePaths) {
    const vectors = fileVectors[filePath];
    const avg = new Array(vectors[0].length).fill(0);
    for (const v of vectors) {
      for (let i = 0; i < v.length; i++) avg[i] += v[i];
    }
    for (let i = 0; i < avg.length; i++) avg[i] /= vectors.length;
    docEmbeddings[filePath] = avg;
  }

  const nodes = filePaths.map(f => ({ id: f, name: path.basename(f), val: fileVectors[f].length }));
  const links: any[] = [];

  for (let i = 0; i < filePaths.length; i++) {
    const f1 = filePaths[i];
    const name1 = path.basename(f1, path.extname(f1));

    for (let j = i + 1; j < filePaths.length; j++) {
      const f2 = filePaths[j];
      const name2 = path.basename(f2, path.extname(f2));

      let linked = false;

      // 1. Explicit WikiLinks
      if (fileMetadata[f1].links.includes(name2) || fileMetadata[f2].links.includes(name1)) {
        links.push({ source: f1, target: f2, value: 1, type: 'explicit' });
        linked = true;
      }

      // 2. Shared Tags
      const commonTags = fileMetadata[f1].tags.filter(t => fileMetadata[f2].tags.includes(t));
      if (commonTags.length > 0) {
        links.push({ source: f1, target: f2, value: 0.8, type: 'tag' });
        linked = true;
      }

      // 3. Similarity (only if not already linked by tags or explicit links, to reduce noise)
      if (!linked) {
        const sim = cosineSimilarity(docEmbeddings[f1], docEmbeddings[f2]);
        if (sim > 0.8) { // Higher threshold for similarity-only links
          links.push({ source: f1, target: f2, value: sim, type: 'similarity' });
        }
      }
    }
  }

  return { nodes, links };
}


