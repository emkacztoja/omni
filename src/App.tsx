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
  citations?: string[];
  streaming?: boolean;
}

function App() {
  const [pingStatus, setPingStatus] = useState<string>('Pinging main process...');
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [targetFile, setTargetFile] = useState<string | undefined>(undefined);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
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

    window.electronAPI.onChatCitations((citations: string[]) => {
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

  const openFile = (filePath: string) => {
    alert(`File reference located at:\n${filePath}`);
  };

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
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium border
              ${activeTab === 'graph' ? 'bg-primary/10 text-primary border-primary/20 bg-gradient-to-r from-primary/10 to-transparent' : 'text-textMuted border-transparent hover:bg-surface hover:text-white'}`}
          >
            <Network className="w-5 h-5" />
            Knowledge Graph
          </button>
        </nav>

        <div className="p-6">
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium border
              ${activeTab === 'settings' ? 'bg-primary/10 text-primary border-primary/20 bg-gradient-to-r from-primary/10 to-transparent' : 'text-textMuted border-transparent hover:bg-surface hover:text-white'}`}
          >
            <Settings className="w-5 h-5" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative w-full overflow-hidden">
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
                                        onClick={() => openFile(c)}
                                        className="text-xs px-2 py-1 rounded bg-surface border border-border text-primary hover:text-white transition-colors"
                                      >
                                        {c.split(/[/\\]/).pop()}
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

              {/* Chat Input Floating */}
              <div className="absolute bottom-8 left-8 right-8">
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
                  <p className="text-textMuted text-sm">Drop .md or .txt files to ingest.</p>
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
      </main>
    </div>
  );
}

export default App;
