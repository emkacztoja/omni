# Omni - Second Brain Architecture & Developer Documentation

## 🎯 Overview
Omni is a blazing-fast, privacy-first, local "Second Brain" desktop application. It ingests personal notes, processes them into vector embeddings, and uses a Retrieval-Augmented Generation (RAG) pipeline to allow users to semantically search and chat with their data. All processing occurs locally, ensuring maximum privacy.

## 🛠️ Technology Stack
* **Frontend (Renderer):** React 18, Vite, TypeScript, Tailwind CSS, Lucide React (Icons), React Force Graph (Knowledge Graph).
* **Backend (Main Process):** Electron (Node.js) written in TypeScript.
* **AI Engine:** Local Ollama instance (typically running on `http://127.0.0.1:11434`).
* **Vector Database:** `vectra` (A local vector database built for Node).

## 📁 Project Structure

### Electron Backend (`electron/`)
* **`main.ts`** - Application entry point. Handles window creation, initialization of background services, and maps `ipcMain` handlers.
* **`db.ts`** - Local Vector DB interactions using `vectra`. Responsible for embedding text chunks via Ollama, performing cosine similarity search for RAG context, and calculating document similarity matrices for the Knowledge Graph. DB interactions are synchronized using a Mutex to prevent race conditions.
* **`ollama.ts`** - A wrapper for the local Ollama API. Provides functions to fetch embeddings (`/api/embeddings`), execute generation (`/api/generate` for auto-tagging), and perform streaming model chat (`/api/chat`).
* **`watcher.ts`** - Utilizes `chokidar` to run a background watcher on the `Omni_Vault` directory. Auto-detects additions or changes, requests AI-driven tags for untagged items, and manages the ingestion of text into the vector database.
* **`preload.ts`** - Implements the Electron ContextBridge API, exposing backend functionality securely to the React renderer without compromising Electron's `contextIsolation` security requirement.
* **`settings.ts`** - Simple synchronous JSON store located in the user data directory that manages application settings like `chatModel`, `embedModel`, and the `systemPrompt`.

### React Frontend (`src/`)
* **`App.tsx`** - The primary view controller containing the sidebar navigation and managing main views:
  * **Search & Chat (RAG)** - Conversational UI for answering questions based on vector DB retrieved chunks.
  * **Vault Files** - Displays all indexed files, allows drag & drop ingestion, and basic note authoring.
  * **Settings** - Dashboard for managing AI configurations and changing active LLM / Embedding models.
* **`components/KnowledgeGraph.tsx`** - Renders an interactive 2D node-based network topology mapping semantic similarities between different user documents.

## 🔄 Core Data Flow Architectures

### 1. Ingestion Pipeline
1. **Trigger:** A `.md` or `.txt` file is added/modified within the `Omni_Vault` folder.
2. **Detection:** `chokidar` in `watcher.ts` detects the event.
3. **Auto-Tagging:** If the file lacks YAML frontmatter, a snippet is sent to the Ollama text generation endpoint to generate relevant tags, which are then appended back to the file on disk.
4. **Vectorization:** The document is split into overlapping chunks and vectorized via Ollama embeddings model.
5. **Storage:** Chunks and their generated vectors are stored locally in the `vectra` DB.

### 2. Retrieval-Augmented Generation (RAG) Retrieval Pipeline
1. **Query Input:** A user submits a query through the Chat interface.
2. **Context Retrieval:** `db.ts` maps the query to a vector, then performs a top-K semantic similarity search across the database index to retrieve the most relevant local chunks.
3. **Prompt Composition:** The system prompt, relevant DB chunks, and the user's explicit query are concatenated into a unified context block.
4. **LLM Inference:** The formulated prompt is handed off to Ollama's chat endpoint in `ollama.ts`.
5. **Streaming Output:** The frontend continuously streams `chat-chunk` messages via IPC to provide a typewriter-style, real-time response to the user. Clickable citations trace directly back to the referenced files.

## 🔌 Inter-Process Communication (IPC)
The React renderer process invokes native operations using asynchronous calls via `window.electronAPI`:
- `save-to-vault`: Creates or overwrites files directly inside `Omni_Vault`.
- `get-vault-files`: Returns active directory files including metadata (size, exact modified dates).
- `delete-vault-file`: Drops physical file and triggers background vector DB purge logic.
- `open-vault-file`: Opens file on the desktop using the native OS editor/viewer via Electron's `shell.openPath`.
- `get-settings` / `save-settings`: Manage local config parameters.
- `get-ollama-models`: Enumerates the tags API for rendering available models in UI select elements.
- `get-graph-data`: Dispatched specifically when building the 2D document relationship topology.
- `search-and-chat`: Resolves history arrays and returns events natively stream handling chunks and UI error notifications.

## 🛡️ Security
As governed by Electron security best practices (e.g., local-first mandate), the `browserWindow` ensures node integration is completely disabled (`nodeIntegration: false`) and strict context isolation is enacted (`contextIsolation: true`). The frontend logic retains zero access to native Node.js libraries, reducing exposure if third-party modules are ever compromised.
