# DocuMind — Chat with Your PDFs Locally (React + Python)

> **A beginner‑friendly, full‑stack starter to upload PDFs and chat with them using a local RAG pipeline.**
>
> Frontend: **React (Vite)** · Backend: **Python API** · Vector store: **local (e.g., ChromaDB)** · Embeddings: **Sentence‑Transformers (e.g., all‑MiniLM‑L6‑v2)** · LLMs: **Cloud (Gemini / OpenAI / DeepSeek)**

---

## Why DocuMind?
- **Local first**: Index PDFs on your machine and ask questions without uploading document contents to a remote server.
- **Simple setup**: Two processes only — a Python API and a Vite React dev server.
- **Math‑ready UI**: Optional **MathJax v3** integration to render equations inline and in display mode.
- **PDF‑aware**: Designed to pair naturally with PDF.js for previews and page‑aware chunking.

---

## Table of Contents
1. [Project Structure](#project-structure)
2. [Prerequisites](#prerequisites)
3. [Quick Start (Windows / VS Code)](#quick-start-windows--vs-code)
4. [Full Setup — Backend (Python)](#full-setup--backend-python)
5. [Full Setup — Frontend (React)](#full-setup--frontend-react)
6. [Environment Variables](#environment-variables)
7. [How It Works (RAG Flow)](#how-it-works-rag-flow)

---

## Project Structure

```
.
├── backend/            # Python API (e.g., app.py, requirements, vector DB files)
├── src/                # React source (Vite)
├── node_modules/       # Frontend deps (auto‑generated)
├── index.html          # Vite HTML entry
├── package.json        # Frontend scripts & deps
└── README.md
```

---

## Prerequisites
- **Python** 3.10+ (3.11 recommended)
- **Node.js** 18+ and **npm** (or pnpm)
- **VS Code** (recommended)

---

## Quick Start (Windows / VS Code)

This is the exact quick path you asked to include — cleaned up and made beginner‑proof:

1) **Open VS Code**, then **open the folder** of this repository (`documind`).

2) **Open two terminals** in VS Code (`Terminal → New Terminal` twice):
   - **Terminal A:** for the **Python server**
   - **Terminal B:** for the **React app**

3) **Terminal A — start the Python server**
   ```powershell
   cd backend
   python -m venv .venv
   .venv\Scripts\Activate        # Windows
   # source .venv/bin/activate    # macOS/Linux
   pip install -r requirements.txt
   python app.py                  # starts the Python API server
   ```

4) **Terminal B — start the React app**
   ```bash
   # from the repo root (where package.json is)
   npm install
   npm run dev
   ```
   - The terminal will print a **local Vite URL** (e.g., `http://localhost:5173`). Click it to open the app.
   - **Do not** open the Python server’s URL in a browser; that endpoint is the API only and will show an error page if browsed directly.

That’s it — upload a PDF in the UI and start asking questions.

---

## Full Setup — Backend (Python)

1) **Create & activate a virtual environment**
   ```bash
   cd backend
   python -m venv .venv
   # Windows
   .venv\Scripts\Activate
   # macOS/Linux
   # source .venv/bin/activate
   ```

2) **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3) **Configure environment** (see [Environment Variables](#environment-variables))
   - Create a file named **`.env`** inside `backend/` and add your API keys and settings.

4) **Run the API**
   ```bash
   python app.py
   ```
   - The server should print something like `Running on http://127.0.0.1:XXXX`.

---

## Full Setup — Frontend (React)

1) **Install dependencies**
   ```bash
   # from the repo root
   npm install
   ```

2) **(Optional) Set frontend env**
   - Create a **`.env`** file at the project root for Vite variables (must start with `VITE_`). Example:
     ```ini
     VITE_API_URL=http://127.0.0.1:8000
     ```

3) **Start the dev server**
   ```bash
   npm run dev
   ```

4) **Build for production**
   ```bash
   npm run build
   npm run preview
   ```

---

## Environment Variables

Create **`backend/.env`** with the variables you actually use. Common examples:

```ini
# --- LLM provider keys (use only what you need) ---
OPENAI_API_KEY=
GOOGLE_API_KEY=           # for Gemini
DEEPSEEK_API_KEY=
```

---

## How It Works (RAG Flow)

1. **Upload** a PDF ➝ parse text per page.
2. **Chunk** text (by tokens or sentences) with page metadata.
3. **Embed** chunks via `sentence-transformers` and **persist** locally (e.g., **ChromaDB** directory).
4. **Retrieve** top‑k chunks for each user question.
5. **Generate** an answer with citations using your chosen LLM.

This design keeps your documents on‑device while allowing flexible model choices.

---

