# app.py — DocuMind backend (Flask) with Google Gen AI (gemini) client
import os
import json
import logging
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# New Gen AI SDK
try:
    from google import genai
except Exception:
    genai = None

# --- Configuration ---
logging.basicConfig(level=logging.DEBUG)
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Default model; change or override with env GEMINI_MODEL
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

INDEX_DIR = Path("./indexed")
INDEX_DIR.mkdir(parents=True, exist_ok=True)

# --- Flask app setup ---
app = Flask(__name__)
CORS(app)

# --- Client creation ---
client = None
if not GEMINI_API_KEY:
    logging.warning("GEMINI_API_KEY not set — Gemini calls will be disabled.")
else:
    if genai is None:
        logging.error("google-genai SDK not installed or importable. Install with: pip install google-genai")
    else:
        try:
            client = genai.Client(api_key=GEMINI_API_KEY)
            logging.info("Gemini client created.")
        except Exception as e:
            logging.exception("Failed to create Gemini client: %s", e)
            client = None

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
    # Very naive retrieval: count overlapping words
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

# --- Endpoints ---
@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "gemini_configured": GEMINI_API_KEY is not None,
        "model": DEFAULT_MODEL
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
            # still continue — indexing to disk is best-effort
            return jsonify({"status": "warning", "message": "Index received but failed to save locally", "error": str(e)}), 200

        return jsonify({"status": "success", "message": "Document indexed successfully"}), 200
    except Exception as e:
        logging.exception("Error in /api/index: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/list-models", methods=["GET"])
def list_models():
    if client is None:
        return jsonify({"error": "Gemini client not configured"}), 500
    try:
        models = client.models.list()
        # models may be objects — attempt to extract .name or .model_id
        names = []
        for m in models:
            # m may be a dict-like or object; try common attrs
            if hasattr(m, "name"):
                names.append(m.name)
            elif isinstance(m, dict) and "name" in m:
                names.append(m["name"])
            else:
                # fallback to repr
                names.append(str(m))
        return jsonify({"models": names})
    except Exception as e:
        logging.exception("Failed to list models: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        payload = request.get_json() or {}
        question = payload.get("question", "").strip()
        collection = payload.get("collection", "").strip()

        if not question:
            return jsonify({"error": "No question provided"}), 400

        if client is None:
            # return helpful error shape expected by frontend
            return jsonify({
                "error": "Gemini API not configured",
                "answer_markdown": "Backend error: Gemini API is not configured. Please check your GEMINI_API_KEY in the .env.",
                "math_expressions": [],
                "sources_markdown": ""
            }), 500

        # If collection provided, try to load the indexed document and perform simple retrieval
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

        # Build the prompt for the model — keep prompt sizes bounded
        system_instructions = (
            "You are an assistant that answers questions using provided context when available. "
            "Return a concise, helpful answer in markdown. If you use math, format it using LaTeX delimiters (\\(...\\) or \\[...\\])."
        )

        # Limit context length to avoid giant prompts
        max_context_chars = 18_000
        if context_text and len(context_text) > max_context_chars:
            context_text = context_text[:max_context_chars] + "\n\n...[truncated]\n"

        # Compose the content passed to the model
        if context_text:
            prompt = (
                f"{system_instructions}\n\n"
                f"Context (from document):\n{context_text}\n\n"
                f"Question: {question}\n\n"
                "Answer in markdown. Cite source pages from the provided context where appropriate."
            )
        else:
            prompt = f"{system_instructions}\n\nQuestion: {question}\n\nAnswer in markdown."

        MODEL_NAME = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)
        logging.debug("Calling model %s with prompt length %d", MODEL_NAME, len(prompt))

        # Call the model
        try:
            # The SDK convenience method; if your installed SDK expects different args,
            # swap to the appropriate call. This pattern generally works with google-genai.
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt
            )
            # `response.text` is typically the combined returned text
            answer_text = getattr(response, "text", None) or str(response)
            return jsonify({
                "answer_markdown": answer_text,
                "math_expressions": [],   # empty — front-end will convert inline math if present
                "sources_markdown": sources_markdown
            })
        except Exception as gen_err:
            logging.exception("Model generation failed: %s", gen_err)
            # Try to return helpful diagnostic including available models (best-effort)
            try:
                models = client.models.list()
                model_list = [m.name if hasattr(m, "name") else (m.get("name") if isinstance(m, dict) else str(m)) for m in models]
            except Exception:
                model_list = None

            err_resp = {
                "error": str(gen_err),
                "answer_markdown": f"Error while calling model: {str(gen_err)}",
                "math_expressions": [],
                "sources_markdown": sources_markdown
            }
            if model_list is not None:
                err_resp["available_models"] = model_list
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
    # For development only. Use a WSGI server for production.
    app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
