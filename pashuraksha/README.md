# पशुरक्षा · PashuRaksha AI

**Livestock Disease Early-Warning, Surveillance & Response Platform**
SIH Problem Statement 26128 · Government of Maharashtra · MSInS

One platform connecting **Farmer → Field Worker → Veterinarian → Laboratory →
Block / District / State authority**, turning field observations into risk
intelligence, alerts and coordinated response.

---

## Quick start

```
Double-click run.bat            (installs deps, starts server, opens browser)
```

or manually:

```
pip install -r requirements.txt
cd backend
python main.py
# open http://127.0.0.1:8000
```

**Every demo login uses OTP `123456`.**

| Role | Phone | Experience |
|---|---|---|
| Farmer (Ramesh Pawar) | 9000000001 | Marathi-first mobile app, voice reporting, offline queue |
| Field worker | 9000000002 | Same app, field channel |
| Veterinarian (Dr. Kulkarni) | 9000000003 | Triage-ranked case queue, samples, treatment |
| Lab technician | 9000000004 | Sample chain-of-custody, results |
| Block Veterinary Officer | 9000000005 | Command center scoped to block |
| District Veterinary Officer | 9000000006 | Full command center |
| State admin | 9000000007 | Full command center + all alerts |

## The 2-minute demo script (the full loop, including money)

1. **Farmer** (9000000001): press 📢, pick 🐄, tap 🎤 and *speak Marathi*
   ("तापाने आजारी आहे, अंगावर गाठी आल्या आहेत") — symptoms auto-tick. Submit.
   Triage banner responds in Marathi; vet is alerted. **Try it in airplane
   mode** — the report queues and syncs on reconnect. Note the home screen:
   live village weather + the upcoming vaccination camp banner.
2. **Vet** (9000000003): the case is at the top of the triage-ranked queue.
   Open → Collect sample → chain-of-custody code appears.
3. **Lab** (9000000004): walk the sample COLLECTED → … → TESTING → mark
   **Positive (LSD)** — the case auto-confirms; block & district are alerted.
4. **District** (9000000006), five tabs:
   - **Overview** — Outbreak Radar (observed vs expected, scan p-value),
     explainable risk (click any circle), One Health flag on the anthrax
     cluster. Press **▶ Simulate next day** to watch the radar respond live.
   - **Action Queue** — tasks auto-created from each detected cluster;
     mark the MVU dispatch done.
   - **Claims** — approve the farmer's compensation claim…
5. **Back to the farmer**: Services tab now shows the claim **APPROVED ✅**.
   *That closes the incentive loop: reporting pays.* Then in **Campaigns**,
   schedule a camp — the farmer's app shows it instantly, in Marathi.
6. **Judge demands we can satisfy live:**
   - *"Add a new disease"* → paste ~20 lines into
     `backend/rules/diseases.yaml`, press **Reload KB**. Done.
   - *"Aggregate at block level instead"* → it's a dropdown.
   - *"Does it work offline?"* → airplane mode, file a report.

## Architecture

```
frontend/  static PWA (no build step) — farmer / vet / gov / IVR + service worker
backend/   FastAPI + SQLAlchemy (SQLite default; set PASHU_DB_URL for Postgres)
  engine.py   triage rules · space-time scan (Kulldorff-style, Poisson p-values)
              · explainable 0-100 risk score (weights per PRD §8.1)
  rules/diseases.yaml   hot-reloadable disease knowledge base (FR-07)
  seed.py     Maharashtra geography + LSD-wave simulator (calibrated shape)
  weather.py  Open-Meteo live signal (keyless, graceful offline fallback)
```

**Safety rule (enforced in architecture):** triage outputs *suspected
categories + severity band + route* — never a diagnosis. Diagnosis and
treatment stay with the registered veterinarian (FR-06, PRD §14).

## PRD traceability

Every FR-01 … FR-20 requirement is implemented; see PRD §19 mapping — the
routes in `backend/main.py` are grouped in the same order.
