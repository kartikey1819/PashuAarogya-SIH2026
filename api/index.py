"""Vercel entrypoint — the same FastAPI app, served as a serverless function.

Vercel's Python runtime looks for a module-level `app` that speaks ASGI, which
is exactly what backend/main.py already exposes. Nothing is duplicated here:
this file only puts the backend on the import path and re-exports it, so the
Render deployment and the Vercel deployment run byte-identical application code.

What differs is the environment, and main.py adapts to it:

  * SERVERLESS is detected from Vercel's own VERCEL variable, so startup skips
    seeding and the keep-alive thread. A serverless process may be frozen or
    discarded between requests -- a background seed would be killed mid-write,
    and a keep-alive makes no sense on a platform that never sleeps.
  * The database must therefore already be populated. Point PASHU_DB_URL at the
    same Postgres the Render service uses (or a Neon one) and seed it once from
    a laptop: PASHU_DB_URL=... python backend/main.py

Static files are NOT served through this function. vercel.json routes them
straight to Vercel's CDN, which is faster and keeps the function cold-start
small -- so the StaticFiles mount inside main.py is simply never reached here.
"""
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "pashuraksha", "backend"))

from main import app  # noqa: E402,F401  (re-exported for the Vercel runtime)
