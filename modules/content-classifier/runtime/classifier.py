#!/usr/bin/env python3
"""Pandoras Box content-safety classifier sidecar.

Loads a small HuggingFace classifier model (default: protectai/deberta-v3-base-
prompt-injection-v2 -- ~600 MB on disk). Exposes a localhost-only HTTP POST
endpoint that scores arbitrary text on six axes and returns a verdict.

Shadow mode by default: scores but does not block. Switch to light-gate mode
by editing CERBERUS_MODE in /opt/pandoras-box/content-classifier/.env after
the calibration window (default 28 days) has produced enough baseline data.

Security:
  - Localhost-only by default.
  - No write endpoints. Read-only scoring service.
  - No model code is executed; only HuggingFace transformers inference.
  - Model files cached under MODEL_CACHE; lazy-load on first request.
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

INSTALL_PATH = os.environ.get("INSTALL_PATH", "/opt/pandoras-box")
PORT = int(os.environ.get("CONTENT_CLASSIFIER_PORT", "8487"))
BIND = os.environ.get("CONTENT_CLASSIFIER_BIND", "127.0.0.1")
MODE = os.environ.get("CONTENT_CLASSIFIER_MODE", "shadow")
FAIL_MODE = os.environ.get("CONTENT_CLASSIFIER_FAIL_MODE", "closed")
MODEL_REPO = os.environ.get("CONTENT_CLASSIFIER_MODEL_REPO",
                             "protectai/deberta-v3-base-prompt-injection-v2")
MODEL_CACHE = os.environ.get("CONTENT_CLASSIFIER_MODEL_CACHE",
                              f"{INSTALL_PATH}/content-classifier/model-cache")

# Lazy load -- the transformers import is heavy.
_pipeline = None

def get_pipeline():
    """Lazy-load the HF pipeline on first request."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    try:
        from transformers import pipeline
        _pipeline = pipeline("text-classification", model=MODEL_REPO,
                             cache_dir=MODEL_CACHE, device=-1)
        print(f"[content-classifier] model loaded: {MODEL_REPO}", flush=True)
        return _pipeline
    except Exception as e:
        print(f"[content-classifier] FAIL to load model: {e}", flush=True)
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Suppress default access log; keep only our explicit prints
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/health":
            self._send(200, {"ok": True, "mode": MODE, "model": MODEL_REPO,
                              "loaded": _pipeline is not None})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/score":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(length).decode("utf-8") if length else ""
            payload = json.loads(body) if body else {}
            text = payload.get("text", "")
            if not isinstance(text, str) or not text:
                self._send(400, {"error": "missing 'text' string"})
                return
            pipe = get_pipeline()
            if pipe is None:
                fail_action = "block" if FAIL_MODE == "closed" else "allow"
                self._send(200, {"verdict": fail_action, "reason": "model not loaded",
                                  "mode": MODE, "fail_mode": FAIL_MODE})
                return
            scores = pipe(text[:4096])  # truncate to model max
            top = scores[0]
            # Verdict: in shadow mode we always allow; in light-gate we block on injection.
            verdict = "allow"
            if MODE != "shadow":
                if top.get("label", "").lower() in {"injection", "unsafe", "jailbreak"} and top.get("score", 0) > 0.85:
                    verdict = "block"
            self._send(200, {"verdict": verdict, "mode": MODE, "scores": scores})
        except Exception as e:
            self._send(500, {"error": str(e)})


def main():
    print(f"[content-classifier] starting on http://{BIND}:{PORT}", flush=True)
    print(f"[content-classifier] mode={MODE}  fail_mode={FAIL_MODE}", flush=True)
    print(f"[content-classifier] model={MODEL_REPO}  cache={MODEL_CACHE}", flush=True)
    Path(MODEL_CACHE).mkdir(parents=True, exist_ok=True)
    httpd = HTTPServer((BIND, PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("[content-classifier] shutdown", flush=True)


if __name__ == "__main__":
    main()
