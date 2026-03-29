import { useEffect, useState, useRef } from 'react';
import { Search, BrainCircuit, Settings, FileText, Send, Trash2, ExternalLink, MessageSquare, Network } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import KnowledgeGraph from './components/KnowledgeGraph';

type Tab = 'search' | 'vault' | 'settings' | 'chat' | 'graph';

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
  streaming?: boolean;
}

function CitationViewer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const [fileContent, setFileContent] = useState<string | null>(null);
  const fileName = citation.filePath.split(/[/\\]/).pop() || '';
  const isImage = /\.(png|jpg|jpeg)$/i.test(fileName);

  useEffect(() => {
    window.electronAPI.readVaultFile(fileName).then(setFileContent);
  }, [fileName]);

  if (fileContent === null) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden scale-in-center">
        <div className="flex items-center justify-between p-4 border-b border-border bg-background/50">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">{fileName}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4 text-textMuted" /> 
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed whitespace-pre-wrap select-text">
          {isImage ? (
            <div className="flex flex-col gap-6">
               <div className="flex justify-center bg-background/30 p-4 rounded-xl border border-border">
                 <img 
                    src={fileContent} 
                    alt={fileName} 
                    className="max-w-full h-auto rounded-lg shadow-xl border border-border max-h-[50vh]" 
                 />
               </div>
               <div className="bg-primary/5 p-5 rounded-xl border border-primary/20 text-textMain relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-1 h-full bg-primary/40"></div>
                 <p className="text-[10px] uppercase tracking-[0.2em] text-primary font-black mb-3 opacity-60">Extracted Context (OCR)</p>
                 <div className="text-sm font-sans leading-relaxed">
                   {citation.content}
                 </div>
               </div>
            </div>
          ) : (() => {
            const parts = fileContent.split(citation.content);
            if (parts.length > 1) {
              return (
                <>
                  {parts[0]}
                  <span className="bg-primary/30 text-white ring-2 ring-primary/50 rounded-sm px-0.5 animate-pulse">
                    {citation.content}
                  </span>
                  {parts.slice(1).join(citation.content)}
                </>
              );
            }
            return fileContent;
          })()}
        </div>
        <div className="p-4 border-t border-border bg-background/30 flex justify-end">
          <button 
            onClick={() => window.electronAPI.openVaultFile(fileName)}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-all border border-border"
          >
            <ExternalLink className="w-4 h-4" />
            Open in System Editor
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // Dynamically resize based on content
    const height = results.length > 0 ? 500 : 80;
    window.electronAPI.resizeSearchWindow(height);
  }, [results]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setResults([]);
    
    // For quick search, we just do a direct semantic search and synthesis
    const msg: Message = { id: Date.now().toString(), role: 'ai', content: '', streaming: true };
    setResults([msg]);

    try {
      await window.electronAPI.searchAndChat([{ role: 'user', content: query }]);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    window.electronAPI.onChatChunk((chunk: string) => {
      setResults(prev => {
        const last = [...prev];
        if (last.length > 0) {
          last[0] = { ...last[0], content: last[0].content + chunk };
        }
        return last;
      });
    });

    window.electronAPI.onChatComplete(() => {
      // Logic for results could go here
    });

    return () => window.electronAPI.removeChatListeners();
  }, []);

  return (
    <div className="w-full h-full flex flex-col bg-[#121212]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden ring-1 ring-white/20">
      <div className="flex items-center px-6 py-4 border-b border-white/5">
        <BrainCircuit className="w-6 h-6 text-primary mr-4 animate-pulse" />
        <input 
          ref={inputRef}
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if(e.key === 'Enter') handleSearch() }}
          placeholder="Global Omni Search..." 
          className="bg-transparent border-none outline-none w-full text-xl text-white placeholder:text-white/20 font-light"
        />
      </div>
      
      {results.length > 0 && (
        <div className="p-6 overflow-y-auto max-h-[400px] prose prose-invert prose-sm">
          {results[0].content === '' ? (
            <div className="flex items-center gap-3 text-white/40 italic">
              <div className="w-2 h-2 bg-primary rounded-full animate-ping"></div>
              Omni is thinking...
            </div>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{results[0].content}</ReactMarkdown>
          )}
        </div>
      )}
    </div>
  );
}

interface IngestProgress {
  filePath: string;
  progress: number;
  status: string;
}

function App() {
  const isSearchMode = new URLSearchParams(window.location.search).get('search') === 'true';
  const [ingestingFiles, setIngestingFiles] = useState<Record<string, IngestProgress>>({});

  useEffect(() => {
    window.electronAPI.onIngestProgress((data) => {
      setIngestingFiles(prev => {
        const next = { ...prev };
        if (data.progress === -1) {
          delete next[data.filePath];
        } else {
          next[data.filePath] = data;
        }
        return next;
      });
    });
  }, []);

  if (isSearchMode) {
    return <QuickSearch />;
  }

  const [pingStatus, setPingStatus] = useState<string>('Pinging main process...');
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [targetFile, setTargetFile] = useState<string | undefined>(undefined);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  
  const [noteContent, setNoteContent] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const fetchVaultFiles = async () => {
    const files = await window.electronAPI.getVaultFiles();
    setVaultFiles(files);
  };

  useEffect(() => {
    if (activeTab === 'vault') {
      fetchVaultFiles();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'settings') {
      window.electronAPI.getSettings().then(setSettings);
      window.electronAPI.getOllamaModels().then(setAvailableModels);
    }
  }, [activeTab]);
  
  useEffect(() => {
    window.electronAPI.getChatHistory().then(setMessages);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      window.electronAPI.saveChatHistory(messages);
    }
  }, [messages]);

  const clearChat = async () => {
    if (confirm('Are you sure you want to clear your chat history?')) {
      setMessages([]);
      await window.electronAPI.saveChatHistory([]);
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const testIPC = async () => {
      try {
        const result = await window.electronAPI.ping();
        setPingStatus(`IPC Status: ${result.toUpperCase()}`);
      } catch (error) {
        setPingStatus('IPC failed or browser mode.');
      }
    };
    testIPC();

    window.electronAPI.onChatCitations((citations) => {
      setMessages(prev => {
        const last = [...prev];
        if (last.length > 0 && last[last.length - 1].role === 'ai') {
            last[last.length - 1] = { ...last[last.length - 1], citations };
        }
        return last;
      });
    });

    window.electronAPI.onChatChunk((chunk: string) => {
      setMessages(prev => {
        const last = [...prev];
        if (last.length > 0 && last[last.length - 1].role === 'ai') {
          last[last.length - 1] = { 
            ...last[last.length - 1], 
            content: last[last.length - 1].content + chunk 
          };
        }
        return last;
      });
    });

    window.electronAPI.onChatComplete(() => {
      setMessages(prev => {
        const last = [...prev];
        if (last.length > 0 && last[last.length - 1].role === 'ai') {
          last[last.length - 1] = { ...last[last.length - 1], streaming: false };
        }
        return last;
      });
      setIsGenerating(false);
    });

    window.electronAPI.onChatError((error: string) => {
       setMessages(prev => [
         ...prev, 
         { id: Date.now().toString(), role: 'ai', content: `**Error:** ${error}`, streaming: false }
       ]);
       setIsGenerating(false);
    });

    return () => {
      window.electronAPI.removeChatListeners();
    };
  }, []);

  const handleQuickAction = (actionText: string) => {
    submitChat(actionText);
  };

  const submitChat = async (text: string) => {
    if (!text.trim() || isGenerating) return;
    
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    const aiPlaceholder: Message = { id: (Date.now() + 1).toString(), role: 'ai', content: '', streaming: true, citations: [] };
    
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, aiPlaceholder]);
    setQuery('');
    setIsGenerating(true);

    try {
      const historyPayload = newMessages.map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.content
      }));
      await window.electronAPI.searchAndChat(historyPayload, targetFile);
    } catch(err) {
      console.error(err);
      setIsGenerating(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    let count = 0;
    for (const file of files) {
      if (file.name.endsWith('.md') || file.name.endsWith('.txt')) {
        const content = await file.text();
        await window.electronAPI.saveToVault(file.name, content);
        count++;
      }
    }
    setSaveStatus(`Saved ${count} file(s) to vault!`);
    await fetchVaultFiles();
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const saveNote = async () => {
    if (!noteContent.trim()) return;
    const filename = `Note-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    await window.electronAPI.saveToVault(filename, noteContent);
    setNoteContent('');
    setSaveStatus('Note saved successfully!');
    await fetchVaultFiles();
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const deleteFile = async (name: string) => {
    if (confirm(`Are you sure you want to delete ${name}?`)) {
      await window.electronAPI.deleteVaultFile(name);
      await fetchVaultFiles();
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    const newSettings = await window.electronAPI.saveSettings(settings);
    setSettings(newSettings);
    alert("Omni AI settings updated!");
  };

  const startDocumentChat = (filename: string) => {
    setTargetFile(filename);
    setActiveTab('chat');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-textMain selection:bg-primary/30">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-surface/50 p-4 flex flex-col backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-3 mb-8 px-2">
          <BrainCircuit className="w-6 h-6 text-primary" />
          <h1 className="font-semibold text-lg tracking-tight">Omni</h1>
        </div>

        <nav className="flex-1 space-y-1">
          <button 
            onClick={() => setActiveTab('search')}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'search' ? 'bg-white/5 text-white' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
          >
            <Search className="w-4 h-4" />
            Search & Chat
          </button>
          
          <button 
            onClick={() => setActiveTab('vault')}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'vault' ? 'bg-white/5 text-white' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
          >
            <FileText className="w-4 h-4" />
            Vault Files
          </button>
          <button 
            onClick={() => setActiveTab('graph')}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'graph' ? 'bg-white/5 text-white' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
          >
            <Network className="w-4 h-4" />
            Knowledge Graph
          </button>
        </nav>

        <div className="p-4 space-y-2">
          <button 
            onClick={clearChat}
            className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-md transition-colors text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Chat History
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'settings' ? 'bg-white/5 text-white' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative w-full overflow-hidden">
        {/* Ingestion Progress Bars */}
        <div className="absolute top-14 left-0 right-0 z-[60] px-8 flex flex-col gap-2 pointer-events-none">
           {Object.values(ingestingFiles).map(file => (
              <div key={file.filePath} className="w-full max-w-md mx-auto bg-surface/90 backdrop-blur border border-primary/20 rounded-lg p-3 shadow-xl animate-in slide-in-from-top-4 duration-300 pointer-events-auto">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold text-white truncate max-w-[200px]">{file.filePath.split(/[/\\]/).pop()}</span>
                    <span className="text-[10px] text-primary font-black uppercase tracking-widest">{file.status}</span>
                 </div>
                 <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]" 
                      style={{ width: `${file.progress}%` }}
                    />
                 </div>
              </div>
           ))}
        </div>

        <header className="h-14 border-b border-border/50 flex items-center px-6 shrink-0 bg-background/80 backdrop-blur z-10">
          <div className="flex-1 font-semibold text-sm">
            {activeTab === 'search' && 'Search & Chat'}
            {activeTab === 'vault' && 'Vault Files'}
            {activeTab === 'settings' && 'Settings'}
            {activeTab === 'chat' && 'Document Chat'}
            {activeTab === 'graph' && 'Knowledge Graph'}
          </div>
          <div className="text-xs text-textMuted flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${pingStatus.includes('PONG') ? 'bg-green-500' : 'bg-red-500'}`}></div>
            {pingStatus}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-8 relative flex flex-col">
          {(activeTab === 'search' || activeTab === 'chat') && (
            <>
              {activeTab === 'chat' && targetFile && (
                <div className="flex items-center justify-between bg-primary/10 border border-primary/20 text-primary px-4 py-3 rounded-xl mb-4 text-sm font-medium animate-in fade-in slide-in-from-top-4">
                  <span>Chatting contextually with: <strong>{targetFile}</strong></span>
                  <button onClick={() => setTargetFile(undefined)} className="hover:text-white transition-colors bg-background px-3 py-1 rounded-md border border-border">Clear Scope</button>
                </div>
              )}

              {messages.length === 0 ? (
                <div className="max-w-3xl flex-1 mx-auto flex flex-col justify-center text-center space-y-6">
                  <h2 className="text-4xl font-light text-white/90">How can I help you today?</h2>

                  <div className="flex gap-4 justify-center mt-8 text-sm">
                    <button 
                      onClick={() => handleQuickAction("Summarize latest notes")}
                      className="px-4 py-2 rounded-lg bg-surface border border-border text-textMuted hover:text-white hover:border-primary/50 transition-colors cursor-pointer active:scale-95"
                    >
                      Summarize latest notes
                    </button>
                    <button 
                      onClick={() => handleQuickAction("Find references to \"LLM\"")}
                      className="px-4 py-2 rounded-lg bg-surface border border-border text-textMuted hover:text-white hover:border-primary/50 transition-colors cursor-pointer active:scale-95"
                    >
                      Find references to "LLM"
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 max-w-4xl mx-auto w-full space-y-6 pb-24">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                       <div className={`max-w-[85%] rounded-2xl px-5 py-4 ${msg.role === 'user' ? 'bg-white/10 text-white shadow-lg' : 'bg-transparent text-textMain'}`}>
                          {msg.role === 'user' ? (
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          ) : (
                            <div className="prose prose-invert prose-sm max-w-none text-textMain">
                              {msg.content === '' && msg.streaming ? (
                                <span className="animate-pulse">Thinking...</span>
                              ) : (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                              )}

                              {/* Citations block */}
                              {msg.citations && msg.citations.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-border/50">
                                  <p className="text-xs text-textMuted mb-2 uppercase tracking-wider font-semibold">Sources</p>
                                  <div className="flex flex-wrap gap-2">
                                    {msg.citations.map((c, i) => (
                                      <button 
                                        key={i} 
                                        onClick={() => setSelectedCitation(c)}
                                        className="text-xs px-2 py-1 rounded bg-surface border border-border text-primary hover:text-white transition-colors flex items-center gap-1.5"
                                      >
                                        <FileText className="w-3 h-3" />
                                        {c.filePath.split(/[/\\]/).pop()}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                       </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {selectedCitation && (
                <CitationViewer 
                  citation={selectedCitation} 
                  onClose={() => setSelectedCitation(null)} 
                />
              )}
            </>
          )}

          {activeTab === 'vault' && (
            <div className="max-w-5xl mx-auto mt-8 w-full grid grid-cols-1 md:grid-cols-2 gap-8 object-cover">

              <div className="space-y-6">
                <div 
                  className={`w-full p-8 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center 
                    ${isDragging ? 'border-primary bg-primary/10 scale-[1.02]' : 'border-border bg-surface/30 hover:bg-surface'}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <FileText className="w-10 h-10 mb-4 text-textMuted" />
                  <h3 className="text-lg font-medium text-white mb-2">Drag & Drop Files</h3>
                  <p className="text-textMuted text-sm">Drop .md, .txt, .pdf or images to ingest.</p>
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-lg font-medium text-white px-1">Quick Note</h3>
                  <textarea 
                    value={noteContent}
                    onChange={e => setNoteContent(e.target.value)}
                    placeholder="Type a new thought or note here..."
                    className="w-full h-32 bg-surface border border-border rounded-xl p-4 text-sm text-textMain placeholder:text-textMuted focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-none transition-all"
                  />
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm text-green-400 font-medium transition-opacity">{saveStatus || ''}</span>
                    <button 
                      onClick={saveNote}
                      disabled={!noteContent.trim()}
                      className="px-6 py-2 bg-primary text-background text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      Save to Vault
                    </button>
                  </div>
                </div>
              </div>

              {/* File List */}
              <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col max-h-[70vh]">
                <h3 className="text-lg font-medium text-white mb-4 flex items-center justify-between">
                  Indexed Files
                  <span className="text-sm bg-primary/20 text-primary px-3 py-1 rounded-full">{vaultFiles.length} files</span>
                </h3>

                <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                  {vaultFiles.length === 0 ? (
                    <p className="text-sm text-textMuted text-center mt-10">Your vault is empty.</p>
                  ) : vaultFiles.map(file => (
                    <div key={file.name} className="flex flex-col p-3 bg-background/50 border border-border rounded-lg hover:bg-background transition-colors group">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate flex-1 text-white">{file.name}</span>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => startDocumentChat(file.name)}
                            className="p-1.5 text-textMuted hover:text-primary hover:bg-primary/10 rounded" title="Chat with Document"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => window.electronAPI.openVaultFile(file.name)}
                            className="p-1.5 text-textMuted hover:text-white hover:bg-white/10 rounded" title="Open Externally"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => deleteFile(file.name)}
                            className="p-1.5 text-textMuted hover:text-red-400 hover:bg-red-400/10 rounded" title="Delete File"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-textMuted">
                        <span>{(file.size / 1024).toFixed(1)} KB</span>
                        <span>•</span>
                        <span>{new Date(file.mtime).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && settings && (
            <div className="max-w-2xl mx-auto mt-8 w-full bg-surface border border-border rounded-2xl p-8 shadow-xl">
              <h2 className="text-2xl font-bold mb-6 text-white text-center">Engine Parameters</h2>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-textMuted mb-2">Generation Model (LLM)</label>
                  <select 
                    value={settings.chatModel}
                    onChange={(e) => setSettings({...settings, chatModel: e.target.value})}
                    className="w-full bg-background border border-border rounded-lg px-4 py-3 text-white appearance-none focus:outline-none focus:border-primary transition-all"
                  >
                    {availableModels.length === 0 && <option value={settings.chatModel}>{settings.chatModel}</option>}
                    {availableModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-textMuted mb-2">Embedding Model (Vector Space)</label>
                  <select 
                    value={settings.embedModel}
                    onChange={(e) => setSettings({...settings, embedModel: e.target.value})}
                    className="w-full bg-background border border-border rounded-lg px-4 py-3 text-white appearance-none focus:outline-none focus:border-primary transition-all"
                  >
                    {availableModels.length === 0 && <option value={settings.embedModel}>{settings.embedModel}</option>}
                    {availableModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-textMuted mb-2">System Prompt Base</label>
                  <textarea 
                    value={settings.systemPrompt}
                    onChange={(e) => setSettings({...settings, systemPrompt: e.target.value})}
                    className="w-full bg-background border border-border rounded-lg px-4 py-3 text-white h-32 resize-none focus:outline-none focus:border-primary transition-all text-sm leading-relaxed"
                  />
                </div>

                <div className="pt-2">
                  <button 
                    onClick={handleSaveSettings}
                    className="w-full py-3 bg-primary text-background font-bold text-sm tracking-wide rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    Save Active Config
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'graph' && (
            <div className="w-full h-full py-4 flex flex-col items-center">
              <div className="w-full max-w-6xl flex justify-between items-end mb-6 px-4">
                <div>
                  <h2 className="text-3xl font-bold text-white mb-2">Semantic Network</h2>
                  <p className="text-sm text-textMuted max-w-xl leading-relaxed">Visualize the topological layout of your Second Brain. Nodes represent discrete documents, and connections are drawn dynamically based on nearest-neighbor vector embeddings.</p>
                </div>
                <div className="text-xs px-3 py-1.5 bg-primary/20 text-primary rounded-full border border-primary/30">
                  {vaultFiles.length} nodes
                </div>
              </div>
              <div className="w-full max-w-6xl flex-1 rounded-2xl overflow-hidden shadow-2xl border border-surface shadow-primary/5">
                <KnowledgeGraph onNodeClick={(filename) => startDocumentChat(filename)} />
              </div>
            </div>
          )}
        </div>

        {/* Chat Input Floating - MOVED OUTSIDE scrolling div */}
        {(activeTab === 'search' || activeTab === 'chat') && (
          <div className="absolute bottom-8 left-8 right-8 z-20">
            <div className="max-w-4xl mx-auto relative group">
              <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
              <div className="relative flex items-center bg-surface/90 border border-border rounded-xl px-4 py-3 shadow-2xl backdrop-blur focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
                <Search className="w-5 h-5 text-textMuted mr-3 shrink-0" />
                <input 
                  type="text" 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if(e.key === 'Enter') submitChat(query) }}
                  disabled={isGenerating}
                  placeholder="Ask Omni..." 
                  className="bg-transparent border-none outline-none w-full text-textMain placeholder:text-textMuted disabled:opacity-50"
                />
                <button 
                  onClick={() => submitChat(query)}
                  disabled={!query.trim() || isGenerating}
                  className="ml-2 p-2 rounded-lg text-textMuted hover:text-primary hover:bg-white/5 disabled:opacity-30 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
