/**
 * Wrapper for Ollama API
 */
import { loadSettings } from './settings';

export async function getEmbedding(text: string): Promise<number[]> {
  const currentModel = loadSettings().embedModel;
  const response = await fetch('http://127.0.0.1:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: currentModel, prompt: text }),
  });
  
  if (!response.ok) throw new Error(`Embedding failed: ${response.statusText}`);
  const data = await response.json() as any;
  return data.embedding;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function getLocalModels(): Promise<string[]> {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags');
    if (!response.ok) return [];
    const data = await response.json() as any;
    return data.models.map((m: any) => m.name);
  } catch (e) {
    return [];
  }
}

export async function generateTags(text: string): Promise<string[]> {
  const currentModel = loadSettings().chatModel;
  // Truncate to first 2000 characters to keep tag generation fast
  const prompt = `Read the following text and generate exactly 3 highly relevant, concise, single-word tags that describe the primary topics. Return ONLY the tags, separated by commas, with no other text, commentary, formatting, or markdown.\n\nText:\n${text.substring(0, 2000)}`;

  try {
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        prompt: prompt,
        stream: false
      }),
    });

    if (!response.ok) return [];

    const data = await response.json() as any;
    const rawTags = data.response as string;
    
    return rawTags.split(',')
      .map((t: string) => t.trim().replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())
      .filter((t: string) => t.length > 0)
      .slice(0, 3);
  } catch (e) {
    console.error('[Omni] Auto-tagging failed:', e);
    return [];
  }
}

export async function chatStream(
  history: ChatMessage[], 
  contextChunks: string[], 
  onChunk: (chunk: string) => void
): Promise<void> {

  const settings = loadSettings();
  const messages = [...history];
  
  if (!messages.find(m => m.role === 'system')) {
    messages.unshift({
      role: 'system',
      content: settings.systemPrompt
    });
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const query = messages[i].content;
      messages[i].content = contextChunks.length > 0 
        ? `Use the following vault context to answer the question (ignore it if irrelevant):\n\n${contextChunks.join('\n\n')}\n\nQuestion: ${query}`
        : query;
      break;
    }
  }

  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.chatModel,
      messages,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) throw new Error(`Chat API failed: ${response.statusText}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunkStr = decoder.decode(value);
    const lines = chunkStr.split('\n').filter(l => l.trim().length > 0);
    
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          onChunk(json.message.content);
        }
      } catch (e) {
      }
    }
  }
}
