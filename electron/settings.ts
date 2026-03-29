import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface AppSettings {
  chatModel: string;
  embedModel: string;
  systemPrompt: string;
}

const defaultSettings: AppSettings = {
  chatModel: 'mistral:latest',
  embedModel: 'nomic-embed-text:latest',
  systemPrompt: 'You are Omni, a local AI assistant. You have access to a vault of notes, PDFs, and images. Use the provided context to answer questions accurately. Note that filenames (like "zaproszenie") may be in different languages. If the user asks in English about an "invite", look for relevant context even if the source is in another language. Always be concise and helpful.'
};

const settingsPath = path.join(app.getPath('userData'), 'omni_settings.json');

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch(e) {}
  return defaultSettings;
}

export function saveSettings(settings: Partial<AppSettings>) {
  const current = loadSettings();
  const next = { ...current, ...settings };
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
  return next;
}
