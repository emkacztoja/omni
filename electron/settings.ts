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
  systemPrompt: 'You are Omni, an intelligent local AI assistant. Answer the user clearly and concisely based primarily on any vault context provided.'
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
