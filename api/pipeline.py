"""
api/pipeline.py — Vercel Python serverless function.

Triggered weekly by Vercel Cron (Friday 6pm UTC, see vercel.json).
Can also be triggered manually via GET/POST for testing.

Flow:
  1. collect_all()    → raw DataFrames
  2. calculate_all()  → clean metrics dict
  3. interpret_all()  → Claude commentary
  4. Merge + store    → Vercel KV as "dashboard:latest"
                      → Vercel KV list "dashboard:history" (last 12 weeks)

Auth: requests must include the CRON_SECRET header (set by Vercel automatically
for cron jobs; pass manually for ad-hoc triggers).
"""

import os
import sys
import json
import hmac
import hashlib
from http.server import BaseHTTPRequestHandler

# Make the pipeline package importable — works both locally and on Vercel
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

from pipeline.collect   import collect_all
from pipeline.calculate import calculate_all
from pipeline.interpret import interpret_all
from upstash_redis import Redis


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

def _get_redis() -> Redis:
    return Redis(
        url=os.environ["KV_REST_API_URL"],
        token=os.environ["KV_REST_API_TOKEN"],
    )


def _store(dashboard: dict) -> None:
    r = _get_redis()
    payload = json.dumps(dashboard, default=str)

    # Always-fresh "latest" key
    r.set("dashboard:latest", payload)

    # Append to history list (keep last 12 weeks)
    r.lpush("dashboard:history", payload)
    r.ltrim("dashboard:history", 0, 11)


# ---------------------------------------------------------------------------
# Auth check
# ---------------------------------------------------------------------------

def _is_authorised(handler: BaseHTTPRequestHandler) -> bool:
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return True  # no secret set → open (dev only)

    # Vercel sends the secret as Authorization: Bearer <secret>
    auth_header = handler.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    return hmac.compare_digest(token, secret)


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self._run()

    def do_POST(self):
        self._run()

    def _run(self):
        if not _is_authorised(self):
            self._respond(401, {"error": "Unauthorized"})
            return

        try:
            collected  = collect_all()
            metrics    = calculate_all(collected)
            commentary = interpret_all(metrics)

            dashboard = {
                "metrics":    metrics,
                "commentary": commentary,
                "as_of_date": metrics["as_of_date"],
            }

            _store(dashboard)

            self._respond(200, {
                "status": "ok",
                "as_of_date": dashboard["as_of_date"],
            })

        except Exception as exc:
            import traceback
            self._respond(500, {
                "error": str(exc),
                "trace": traceback.format_exc(),
            })

    def _respond(self, status: int, body: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def log_message(self, *args):
        pass  # suppress default access logs on Vercel
