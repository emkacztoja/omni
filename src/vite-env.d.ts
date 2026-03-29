/// <reference types="vite/client" />

interface VaultFile {
  name: string;
  size: number;
  mtime: number;
}

interface AppSettings {
  chatModel: string;
  embedModel: string;
  systemPrompt: string;
}

interface Citation {
  filePath: string;
  content: string;
}

interface GraphData {
  nodes: { id: string; name: string; val: number }[];
  links: { source: string; target: string; value: number; type: 'similarity' | 'explicit' | 'tag' }[];
}

interface Window {
  electronAPI: {
    ping: () => Promise<string>;
    getVaultFiles: () => Promise<VaultFile[]>;
    deleteVaultFile: (filename: string) => Promise<boolean>;
    openVaultFile: (filename: string) => Promise<boolean>;
    readVaultFile: (filename: string) => Promise<string | null>;
    getSettings: () => Promise<AppSettings>;
    saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    getOllamaModels: () => Promise<string[]>;
    getGraphData: () => Promise<GraphData>;
    resizeSearchWindow: (height: number) => Promise<void>;
    getChatHistory: () => Promise<any[]>;
    saveChatHistory: (history: any[]) => Promise<boolean>;
    saveToVault: (filename: string, content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    searchAndChat: (history: {role: string, content: string}[], targetFile?: string) => Promise<boolean>;
    onChatChunk: (callback: (chunk: string) => void) => void;
    onChatCitations: (callback: (citations: Citation[]) => void) => void;
    onChatComplete: (callback: () => void) => void;
    onChatError: (callback: (error: string) => void) => void;
    onIngestProgress: (callback: (data: { filePath: string; progress: number; status: string }) => void) => void;
    removeChatListeners: () => void;
  };
}
