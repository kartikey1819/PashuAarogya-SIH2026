# Deploying PashuAarogya

> **The plan in one line:** ngrok stays the primary demo link (it has the AI model
> and your laptop's speed). Render is the **backup** — the same app, minus Pashu
> Lens, on a URL that is live even if your laptop isn't. Set it up once now; it
> costs nothing and it's there if the venue Wi-Fi or your machine lets you down.
>
> Jump to [the backup recipe](#the-backup-recipe-render-without-the-ai-model).

## Read this first: don't split the frontend onto Vercel

It's a natural instinct, but in this project it costs you work and buys nothing.

The frontend here is **plain static HTML/CSS/JS that the FastAPI backend already
serves** (`app.mount("/", StaticFiles(...))`). Frontend and backend are one app on
one origin. Splitting them means:

| Splitting costs you | Why |
|---|---|
| A CORS preflight on every API call | Extra round-trip added to every single request, on mobile networks |
| Two deploys to keep in sync | A frontend change and a backend change now ship separately |
| An API-base config to manage | Wrong value = white screen with console errors |
| Service-worker scope headaches | Offline caching is scoped to an origin; the API is now on another |

And it fixes nothing, because **every page calls the API immediately on load** — a
CDN-fast frontend still waits on the backend. Vercel helps when you have a heavy
React bundle or server-rendered pages. This app's entire frontend is 960 KB.

> **Recommendation: deploy the whole app as one Render web service, with Postgres.**
> One URL, no CORS, one deploy. Steps below. The Vercel split is documented after,
> in case you want it anyway.

The three things that *actually* matter for going live are the database, the cold
start, and the AI model. All three are handled below.

---

## Option A (recommended) — one service on Render + Postgres

### 1. Push to GitHub
Already done — the repo is `kartikey1819/SIH_2026`, branch `feature/pashuaarogya-v2`.
Merge it to `main` first if you want Render's default branch to work out of the box.

### 2. Create the service
Render dashboard → **New → Blueprint** → pick this repo. It reads
[`render.yaml`](render.yaml) and creates both the web service and a free Postgres
database, already wired together.

Prefer clicking through manually? **New → Web Service**, then:

| Field | Value |
|---|---|
| Root directory | `pashuraksha` |
| Runtime | Python 3 |
| Build command | `pip install -r requirements.txt` |
| Start command | `cd backend && python main.py` |
| Health check path | `/healthz` |
| Region | Singapore (closest to India) |

### 3. Add the database — this is the step people skip
**Render's free disk is ephemeral.** If you leave it on SQLite, every record your
judges create is wiped on the next deploy *and* every time the service sleeps.

Create a free Postgres (Render's own, or [Neon](https://neon.tech) — Neon's free
tier doesn't expire, Render's free database is removed after 30 days), then set:

```
PASHU_DB_URL = postgresql://user:pass@host/dbname
```

No code changes needed — `database.py` already reads it, and also accepts
`DATABASE_URL`, which is what Render and Neon inject automatically. The old
`postgres://` scheme is rewritten for you.

### 4. Environment variables

| Key | Value |
|---|---|
| `PASHU_DB_URL` | your Postgres connection string (or let the blueprint wire it) |
| `PASHU_SECRET` | any long random string — signs session tokens |
| `GEMINI_API_KEY` | your key from `.env`, for पशु मित्र |
| `PASHU_AI_URL` | only if you deploy the breed model (step 6) |

### 5. First boot
The demo world (87 locations, 784 animals, ~1,000 historical cases) seeds itself
on first start against the empty database. Seeding runs **in a background thread**
so the port opens immediately and Render's health check passes — watch progress at:

```
https://your-app.onrender.com/healthz
→ {"ok":true,"ready":false,"stage":"seeding", ...}
→ {"ok":true,"ready":true,"stage":"ready","locations":87, ...}
```

Give it 1–3 minutes on Postgres. Until `ready` is true, dashboards will look empty.

### 6. Pashu Lens (the breed model) — the honest constraint
<a id="the-backup-recipe-render-without-the-ai-model"></a>
**It will not run on Render's free tier.** TensorFlow plus the 235 MB
EfficientNetV2 model needs well over the 512 MB RAM free instances get; it will
OOM on load.

**For a backup instance, just turn it off** — `render.yaml` already sets:

```
PASHU_AI_DISABLED = 1
```

This is a first-class state, not a broken one. Verified behaviour with it set:

| | Without the model |
|---|---|
| Pashu Lens card | Camera/gallery buttons dim, **✍️ Register manually** appears in their place |
| Manual registration | Species → breed (Maharashtra breeds, or type your own) → sex → age → saved with a real Tag ID |
| `/api/ai/status` | Answers in **2 ms**, cached — no connect-timeout stall on page load |
| Message shown | *"Breed identification is not enabled on this deployment. You can still register the animal by hand."* |
| Everything else | Outbreak Radar, History, Forecast, passports, claims, camps, पशु मित्र — all unaffected |

So the backup demonstrates 5 of the 6 innovations; only Pashu Lens is absent, and
it says so in plain words rather than erroring.

**Want the model live too?** [HuggingFace Spaces](https://huggingface.co/spaces)
(Docker SDK, 16 GB RAM free CPU tier) fits it comfortably: push
`breed-ai-service/` there, then on Render set `PASHU_AI_DISABLED=0` and
`PASHU_AI_URL=https://<your-space>.hf.space`. A Render Standard instance (2 GB)
also works, for money.

### The backup recipe — Render without the AI model

The short version, assuming the repo is on GitHub:

1. Render → **New → Blueprint** → this repo. `render.yaml` creates the web
   service *and* a free Postgres, already wired, with `PASHU_AI_DISABLED=1`.
2. Paste `GEMINI_API_KEY` into the service's Environment tab (optional — without
   it पशु मित्र falls back to its rule-based skills).
3. Wait for `/healthz` to report `"ready": true` — 1–3 minutes while it seeds.
4. Point UptimeRobot at `/healthz` every 10 minutes so it never sleeps.
5. Keep the URL in your pocket. Demo from ngrok; switch if anything goes wrong.

Keep in mind the two instances have **separate databases** — a report filed on
ngrok will not appear on Render. That is fine for a backup; just don't present
from both at once.

### 7. Keep it awake
Free Render services sleep after 15 minutes idle and take ~50 s to wake — fatal
mid-presentation. Point a free uptime pinger
([UptimeRobot](https://uptimerobot.com), [cron-job.org](https://cron-job.org)) at:

```
https://your-app.onrender.com/healthz   every 10 minutes
```

That endpoint is deliberately cheap. Still, **open the URL yourself 5 minutes
before you present.**

---

## Option B — frontend on Vercel, backend on Render

Only worth it if you specifically want a `*.vercel.app` domain or Vercel's CDN.

1. Deploy the backend on Render exactly as in Option A.
2. Tell the frontend where the API lives. Add this line to the `<head>` of every
   page in `frontend/`, **before** the `api.js` script tag:

   ```html
   <meta name="pashu-api" content="https://your-app.onrender.com">
   ```

   `api.js` already reads it (also accepts `window.PASHU_API`). With nothing set
   it stays same-origin, so local development is unaffected.
3. Deploy `pashuraksha/frontend` to Vercel as a static site — no build step, no
   framework preset.
4. CORS already allows all origins, and auth is a Bearer token rather than a
   cookie, so no credentialed-CORS configuration is needed.

Caveats specific to this split: the service worker caches the app shell on the
Vercel origin while API calls go to Render, so an offline farmer sees the UI but
no data — acceptable, since the offline report queue still works. And you must
remember to redeploy both sides together.

---

## Local development is unchanged

```bat
run.bat
```
still starts SQLite + the AI sidecar + the ngrok tunnel on `127.0.0.1:8000`.
None of the deployment changes affect it.

---

## Quick reference

| Env var | Purpose | Default |
|---|---|---|
| `PORT` | port to bind (platforms inject this) | `8000` |
| `PASHU_DB_URL` / `DATABASE_URL` | Postgres DSN | local SQLite file |
| `PASHU_SECRET` | session-token signing key | dev default — **set it in production** |
| `GEMINI_API_KEY` | Pashu Mitra assistant | assistant falls back to rule-based skills |
| `PASHU_AI_URL` | Pashu Lens sidecar | `http://127.0.0.1:8001` |
| `PASHU_TUNNEL_DOMAIN` | ngrok reserved domain (local only) | from `tunnel.json` |

| Endpoint | Use |
|---|---|
| `/healthz` | platform health check, keep-alive, seeding progress |
| `/api/db/health` | row counts and recent writes — proof the database is persisting |
