# documind/backend/app.py
import os
import json
import logging
import shutil
import atexit
import signal
import sys
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

# --- Configuration ---
logging.basicConfig(level=logging.DEBUG)
load_dotenv()

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Default model - updated to a current Gemini 2.5 Flash model (recommended for price/perf)
# You can override this by setting the DEFAULT_MODEL environment variable.
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemini-2.5-flash")

# INDEX_DIR explicitly resolved relative to this file (documind/backend/indexed)
INDEX_DIR = Path(__file__).resolve().parent / "indexed"
INDEX_DIR.mkdir(parents=True, exist_ok=True)

# --- Flask app setup ---
app = Flask(__name__)
CORS(app)

# --- Client creation ---
gemini_client = None

if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_client = genai
        logging.info("Gemini client created.")
    except Exception as e:
        logging.exception("Failed to create Gemini client: %s", e)

# --- Cleanup on exit: remove indexed files/folders ---
def clear_index_dir():
    """Delete all files and subdirectories inside the INDEX_DIR."""
    try:
        if INDEX_DIR.exists() and INDEX_DIR.is_dir():
            for p in INDEX_DIR.iterdir():
                try:
                    if p.is_dir():
                        shutil.rmtree(p)
                        logging.debug("Removed directory: %s", p)
                    else:
                        p.unlink()
                        logging.debug("Removed file: %s", p)
                except Exception as e:
                    logging.exception("Failed to remove '%s': %s", p, e)
            logging.info("Cleared index directory %s", INDEX_DIR)
        else:
            logging.debug("Index directory %s does not exist (nothing to clear).", INDEX_DIR)
    except Exception as e:
        logging.exception("Error while clearing index directory %s: %s", INDEX_DIR, e)

def _handle_shutdown(signum=None, frame=None):
    logging.info("Shutdown initiated (signal=%s). Clearing index directory...", signum)
    try:
        clear_index_dir()
    except Exception as e:
        logging.exception("Error during shutdown cleanup: %s", e)
    # Exit the process after cleanup
    try:
        sys.exit(0)
    except SystemExit:
        pass

# Run clear on startup to guarantee stale files are removed
clear_index_dir()

# Ensure cleanup runs on normal interpreter exit too
atexit.register(clear_index_dir)

# Hook common termination signals so cleanup runs on Ctrl+C or SIGTERM
try:
    signal.signal(signal.SIGINT, _handle_shutdown)
except Exception as e:
    logging.debug("SIGINT handler could not be set: %s", e)

try:
    signal.signal(signal.SIGTERM, _handle_shutdown)
except Exception as e:
    logging.debug("SIGTERM handler not supported on this platform or could not be set: %s", e)

# --- Helpers ---
def index_path_for(collection_name: str) -> Path:
    safe = collection_name.replace("/", "_")
    return INDEX_DIR / f"{safe}.json"

def save_index_to_disk(collection_name: str, payload: dict):
    p = index_path_for(collection_name)
    with p.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logging.info("Saved index to %s", p)

def load_index_from_disk(collection_name: str):
    p = index_path_for(collection_name)
    if not p.exists():
        return None
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)

def retrieve_top_chunks(chunks, question, top_k=3):
    qwords = set([w for w in (question or "").lower().split() if w.isalnum()])
    if not qwords:
        return []
    scored = []
    for i, c in enumerate(chunks):
        text = c.get("text", "").lower()
        count = sum(1 for w in qwords if w in text)
        scored.append((count, i))
    scored.sort(reverse=True)
    top = [chunks[i] for score, i in scored[:top_k] if score > 0]
    return top

# --- Model calling functions ---
def call_gemini_model(prompt, model_name):
    if not gemini_client:
        raise Exception("Gemini client not configured")
    try:
        model = gemini_client.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        raise Exception(f"Gemini error: {str(e)}")

# --- Endpoints ---
@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "models": {
            "gemini": GEMINI_API_KEY is not None
        },
        "default_model": DEFAULT_MODEL
    })

@app.route("/api/index", methods=["POST"])
def index_document():
    try:
        data = request.get_json() or {}
        collection = data.get("collection")
        chunks = data.get("chunks", [])
        source = data.get("source") or "unknown"
        if not collection:
            return jsonify({"error": "Missing collection name"}), 400
        logging.info("Received %d chunks for collection: %s", len(chunks), collection)

        payload = {
            "source": source,
            "chunks": chunks,
            "totalPages": data.get("totalPages"),
            "processedAt": data.get("processedAt")
        }
        try:
            save_index_to_disk(collection, payload)
        except Exception as e:
            logging.exception("Failed to save index to disk: %s", e)
            return jsonify({"status": "warning", "message": "Index received but failed to save locally", "error": str(e)}), 200

        return jsonify({"status": "success", "message": "Document indexed successfully"}), 200
    except Exception as e:
        logging.exception("Error in /api/index: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/list-models", methods=["GET"])
def list_models():
    models = []
    
    # Add Gemini models if configured
    if gemini_client:
        try:
            for m in gemini_client.list_models():
                models.append({"name": m.name, "provider": "gemini"})
        except Exception as e:
            logging.exception("Failed to list Gemini models: %s", e)
    
    return jsonify({"models": models})

@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        payload = request.get_json() or {}
        question = payload.get("question", "").strip()
        collection = payload.get("collection", "").strip()
        model_name = payload.get("model", DEFAULT_MODEL)

        if not question:
            return jsonify({"error": "No question provided"}), 400

        # Check if Gemini is configured
        if not gemini_client:
            return jsonify({
                "error": "Gemini API not configured",
                "answer_markdown": "Backend error: Gemini API is not configured. Please check your GEMINI_API_KEY in the .env.",
                "math_expressions": [],
                "sources_markdown": ""
            }), 500

        # Retrieve context if collection provided
        context_text = ""
        sources_markdown = ""
        if collection:
            stored = load_index_from_disk(collection)
            if stored and isinstance(stored.get("chunks"), list):
                top_chunks = retrieve_top_chunks(stored["chunks"], question, top_k=3)
                if top_chunks:
                    ctxt_parts = []
                    for c in top_chunks:
                        page = c.get("page")
                        text = c.get("text", "")
                        if page:
                            ctxt_parts.append(f"(page {page}) {text}")
                        else:
                            ctxt_parts.append(text)
                    context_text = "\n\n---\n\n".join(ctxt_parts)
                    sources_markdown = f"Source: Document '{collection}'"
                else:
                    sources_markdown = f"Source: Document '{collection}' (no high-overlap chunks found)"
            else:
                sources_markdown = f"Source: Document '{collection}' (not found on server)"

        # Enhanced system instructions for smarter AI responses
        system_instructions = (
            "You are an intelligent assistant that answers questions using provided context when available. "
            "Your responses should be well-organized, using markdown formatting to enhance readability:\n"
            "- Use **bold** to highlight key terms and important concepts\n"
            "- Use bullet points or numbered lists for structured information\n"
            "- Use headings (##) to organize sections\n"
            "- When appropriate, create summaries, outlines, or study notes\n"
            "- Always cite source pages from the provided context\n"
            "- For requests like 'summarize unit 5' or 'make notes on chapter 3', identify the relevant sections and provide organized output\n"
            "- Prioritize accuracy and clarity in your responses\n\n"
            "Example formatting for notes:\n"
            "## Key Concepts\n"
            "- **Term**: Definition...\n"
            "- **Process**: Step-by-step explanation...\n\n"
            "## Summary\n"
            "Concise summary of the main points...\n\n"
            "Remember to use LaTeX delimiters (\\(...\\) or \\[...\\]) for any mathematical expressions."
        )

        max_context_chars = 18_000
        if context_text and len(context_text) > max_context_chars:
            context_text = context_text[:max_context_chars] + "\n\n...[truncated]\n"

        if context_text:
            prompt = (
                f"{system_instructions}\n\n"
                f"Context (from document):\n{context_text}\n\n"
                f"Question: {question}\n\n"
                "Answer in markdown. Cite source pages from the provided context where appropriate."
            )
        else:
            prompt = f"{system_instructions}\n\nQuestion: {question}\n\nAnswer in markdown."

        logging.debug("Calling model %s with prompt length %d", model_name, len(prompt))

        # Call the Gemini model
        try:
            answer_text = call_gemini_model(prompt, model_name)
            return jsonify({
                "answer_markdown": answer_text,
                "math_expressions": [],
                "sources_markdown": sources_markdown
            })
        except Exception as gen_err:
            logging.exception("Model generation failed: %s", gen_err)
            err_resp = {
                "error": str(gen_err),
                "answer_markdown": f"Error while calling model: {str(gen_err)}",
                "math_expressions": [],
                "sources_markdown": sources_markdown
            }
            return jsonify(err_resp), 500

    except Exception as e:
        logging.exception("Unexpected error in /api/chat: %s", e)
        return jsonify({
            "error": str(e),
            "answer_markdown": f"Error: {str(e)}",
            "math_expressions": [],
            "sources_markdown": ""
        }), 500

# --- Entrypoint ---
if __name__ == "__main__":
    try:
        app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
    finally:
        # In case app.run returns (rare), ensure cleanup
        try:
            clear_index_dir()
        except Exception as e:
            logging.exception("Final cleanup failed: %s", e)
