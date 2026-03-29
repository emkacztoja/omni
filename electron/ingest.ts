const { PDFParse } = require('pdf-parse');
import fs from 'fs';
import Tesseract from 'tesseract.js';
import path from 'path';
import { loadSettings } from './settings';

export async function parsePDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  try {
    // Convert Node.js Buffer to Uint8Array as required by pdfjs/pdf-parse
    const uint8Array = new Uint8Array(dataBuffer);
    const pdf = new PDFParse({ data: uint8Array });
    const textResult = await pdf.getText();
    return textResult.text || '';
  } catch (err) {
    console.error(`Error parsing PDF ${filePath}:`, err);
    return '';
  }
}

export async function parseImage(filePath: string, onProgress: (progress: number, status: string) => void): Promise<string> {
  const fileName = path.basename(filePath);
  console.log(`[Omni] AI-Assisted OCR starting for: ${fileName}`);
  try {
    // 1. RAW Tesseract Extraction
    const { data: { text } } = await Tesseract.recognize(filePath, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          onProgress(m.progress * 0.8 * 100, `OCR: ${Math.round(m.progress * 100)}%`);
        } else {
          onProgress(0, m.status);
        }
      }
    });

    if (text.trim().length === 0) return '';

    // 2. AI Refinement (The "AI-Assisted" part)
    onProgress(85, 'AI Cleaning...');
    const refinedText = await refineOCRWithAI(text, fileName);
    onProgress(100, 'Done');

    return refinedText;
  } catch (err) {
    console.error(`Error parsing image ${filePath}:`, err);
    return '';
  }
}

async function refineOCRWithAI(rawText: string, fileName: string): Promise<string> {
  const settings = loadSettings();
  const prompt = `### TASK: CLEAN MESSY OCR TEXT
You are an expert document restorer. The text below is a raw, messy OCR dump from a file named "${fileName}". It contains random symbols, artifacts, and noise (e.g., "=", "°", "/", "@", "X", etc.) that are NOT part of the original message.

### YOUR GOALS:
1. STRIP all OCR garbage, random symbols, and decorative characters that don't form words.
2. RECONSTRUCT the original human message into a clean, structured, and highly readable format.
3. FIX obvious character misrecognitions (e.g., "J" instead of "It", "0" instead of "O").
4. PRESERVE the original language(s) (e.g., English, German, Polish).
5. MAINTAIN all dates, names, and contact info exactly as they appear.

### OUTPUT RULES:
- Return ONLY the cleaned, professional text.
- NO conversational filler.
- NO preambles like "Here is the cleaned text".
- If the text is a list or a letter, format it as such.

### RAW OCR DATA:
${rawText.substring(0, 4000)}`;

  try {
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.chatModel,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1 // Lower temperature for more accurate reconstruction
        }
      }),
    });

    if (!response.ok) return rawText;

    const data = await response.json() as any;
    return data.response as string;
  } catch (e) {
    console.error('[Omni] AI refinement failed:', e);
    return rawText;
  }
}
