"""PashuAarogya AI — FastAPI application (all routes).

Run:  python main.py        (from backend/)
Then open http://127.0.0.1:8000
"""
import os, json, hmac, base64, hashlib, random, time
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import Base, engine, get_db, SessionLocal
from models import (Location, User, Farmer, Animal, Case, Vaccination,
                    Treatment, Sample, RiskScore, Outbreak, Alert, AuditLog,
                    WeatherObservation, Claim, Task, Camp)
import engine as intel
import seed as seeder
import weather as wx
import forecast as fc

AI_URL = os.environ.get("PASHU_AI_URL", "http://127.0.0.1:8001")

SECRET = os.environ.get("PASHU_SECRET", "pashuraksha-demo-secret")
DEMO_OTP = "123456"

app = FastAPI(title="PashuAarogya AI", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


# ------------------------------------------------------------------ startup --
@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    # lightweight migration for databases created before this column existed
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "ALTER TABLE treatments ADD COLUMN withdrawal_days INTEGER DEFAULT 0")
    except Exception:
        pass
    db = SessionLocal()
    try:
        if seeder.seed_all(db):
            intel.refresh_all(db)
    finally:
        db.close()


# --------------------------------------------------------------------- auth --
def make_token(user_id: int) -> str:
    payload = f"{user_id}.{int(time.time())}"
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:24]
    return base64.urlsafe_b64encode(f"{payload}.{sig}".encode()).decode()


def parse_token(token: str) -> Optional[int]:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        uid, ts, sig = raw.split(".")
        expect = hmac.new(SECRET.encode(), f"{uid}.{ts}".encode(),
                          hashlib.sha256).hexdigest()[:24]
        if hmac.compare_digest(sig, expect):
            return int(uid)
    except Exception:
        pass
    return None


def current_user(authorization: str = Header(default=""),
                 db: Session = Depends(get_db)) -> User:
    token = authorization.replace("Bearer ", "")
    uid = parse_token(token)
    if not uid:
        raise HTTPException(401, "Not authenticated")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "Unknown user")
    return user


def audit(db, user_id, action, detail=""):
    db.add(AuditLog(user_id=user_id, action=action, detail=detail))


class OTPRequest(BaseModel):
    phone: str

class OTPVerify(BaseModel):
    phone: str
    otp: str


@app.post("/api/auth/request-otp")
def request_otp(body: OTPRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone == body.phone).first()
    if not user:
        raise HTTPException(404, "Phone not registered. Use a demo login from the list.")
    # In production: send SMS via gateway. Demo: fixed OTP.
    return {"sent": True, "demo_hint": DEMO_OTP}


@app.post("/api/auth/verify")
def verify_otp(body: OTPVerify, db: Session = Depends(get_db)):
    if body.otp != DEMO_OTP:
        raise HTTPException(401, "Invalid OTP")
    user = db.query(User).filter(User.phone == body.phone).first()
    if not user:
        raise HTTPException(404, "Phone not registered")
    audit(db, user.id, "login", user.role); db.commit()
    loc = db.get(Location, user.location_id) if user.location_id else None
    return {"token": make_token(user.id),
            "user": {"id": user.id, "name": user.name, "role": user.role,
                     "lang": user.lang, "location": loc.name if loc else None,
                     "location_id": user.location_id}}


@app.get("/api/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    loc = db.get(Location, user.location_id) if user.location_id else None
    return {"id": user.id, "name": user.name, "role": user.role,
            "lang": user.lang, "location": loc.name if loc else None,
            "location_id": user.location_id}


# ---------------------------------------------------------------- locations --
@app.get("/api/locations")
def locations(db: Session = Depends(get_db)):
    rows = db.query(Location).all()
    return [{"id": l.id, "name": l.name, "name_mr": l.name_mr, "level": l.level,
             "lgd": l.lgd_code, "parent_id": l.parent_id,
             "lat": l.lat, "lon": l.lon} for l in rows]


# ----------------------------------------------------------------------- KB --
@app.get("/api/kb")
def get_kb():
    return intel.load_kb()


@app.post("/api/kb/reload")
def reload_kb(user: User = Depends(current_user), db: Session = Depends(get_db)):
    kb = intel.load_kb(force=True)
    audit(db, user.id, "kb_reload", f"{len(kb['diseases'])} diseases"); db.commit()
    return {"reloaded": True, "diseases": list(kb["diseases"].keys())}


# ------------------------------------------------------------------ animals --
@app.get("/api/animals")
def my_animals(user: User = Depends(current_user), db: Session = Depends(get_db)):
    fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
    if not fm:
        return []
    out = []
    for a in fm.animals:
        vaccs = (db.query(Vaccination).filter(Vaccination.animal_id == a.id)
                   .order_by(Vaccination.given_on.desc()).all())
        out.append({"id": a.id, "tag_id": a.tag_id, "species": a.species,
                    "breed": a.breed, "sex": a.sex, "age_months": a.age_months,
                    "vaccinations": [{"disease": v.disease_key,
                                      "given_on": str(v.given_on),
                                      "due_on": str(v.due_on)} for v in vaccs],
                    "withdrawal": _withdrawal_status(db, a.id),
                    "permit": _permit_status(db, a.village_id, a.id)})
    return out


# ------------------------------------------------ passport / permit helpers --
def _withdrawal_status(db, animal_id: int):
    """Milk/meat withdrawal countdown from the latest treatment on this animal."""
    tr = (db.query(Treatment).join(Case, Treatment.case_id == Case.id)
            .filter(Case.animal_id == animal_id)
            .order_by(Treatment.given_at.desc()).first())
    if not tr or not tr.withdrawal_days:
        return None
    until = tr.given_at + timedelta(days=tr.withdrawal_days)
    left = (until - datetime.utcnow()).days + 1
    if left <= 0:
        return None
    return {"until": until.date().isoformat(), "days_left": left,
            "diagnosis": tr.diagnosis, "treatment": tr.treatment}


def _permit_status(db, village_id: int, animal_id: int | None = None):
    """Movement permit: BLOCKED inside an active outbreak zone, HOLD if the
    animal itself has an open case, else ALLOWED. Enforced at checkposts/markets
    by scanning the passport QR."""
    kb = intel.load_kb()
    for ob in db.query(Outbreak).filter(Outbreak.status == "ACTIVE").all():
        zone = json.loads(ob.zone_village_ids or "[]")
        if village_id in zone:
            dn = kb["diseases"].get(ob.suspected or "", {}).get("name", {})
            until = (ob.detected_at + timedelta(days=21)).date().isoformat()
            return {"status": "BLOCKED",
                    "reason_en": f"Village inside active {dn.get('en', 'disease')} "
                                 f"containment zone (cluster #{ob.id})",
                    "reason_hi": f"गाँव सक्रिय {dn.get('hi', 'रोग')} नियंत्रण क्षेत्र में है",
                    "reason_mr": f"गाव सक्रिय {dn.get('mr', 'रोग')} नियंत्रण क्षेत्रात आहे",
                    "until": until, "outbreak_id": ob.id}
    if animal_id:
        open_case = (db.query(Case).filter(Case.animal_id == animal_id,
                                           Case.status.notin_(["CLOSED"])).first())
        if open_case:
            return {"status": "HOLD",
                    "reason_en": f"Animal has an open case #{open_case.id} ({open_case.status})",
                    "reason_hi": f"पशु का केस #{open_case.id} चल रहा है",
                    "reason_mr": f"जनावराची केस #{open_case.id} सुरू आहे",
                    "until": None}
    return {"status": "ALLOWED", "reason_en": "No restriction",
            "reason_hi": "कोई प्रतिबंध नहीं", "reason_mr": "कोणतेही निर्बंध नाहीत", "until": None}


class AnimalIn(BaseModel):
    species: str
    breed: str = ""
    sex: str = "F"
    age_months: int = 24


@app.post("/api/animals")
def add_animal(body: AnimalIn, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
    if not fm:
        raise HTTPException(403, "Farmer profile required")
    tag = f"IN{random.randint(100000000000, 999999999999)}"
    a = Animal(tag_id=tag, species=body.species, breed=body.breed, sex=body.sex,
               age_months=body.age_months, farmer_id=fm.id, village_id=fm.village_id)
    db.add(a); audit(db, user.id, "animal_add", tag); db.commit()
    return {"id": a.id, "tag_id": tag}


# ------------------------------------------------------------------ reports --
class ReportIn(BaseModel):
    client_uuid: Optional[str] = None
    species: str
    symptoms: list[str]
    affected_count: int = 1
    dead_count: int = 0
    animal_id: Optional[int] = None
    village_id: Optional[int] = None
    notes: str = ""
    photo: Optional[str] = None
    channel: str = "app"


@app.post("/api/reports")
def create_report(body: ReportIn, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    # offline dedup
    if body.client_uuid:
        dup = db.query(Case).filter(Case.client_uuid == body.client_uuid).first()
        if dup:
            return _case_out(db, dup, dedup=True)

    fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
    village_id = body.village_id or (fm.village_id if fm else user.location_id)
    if not village_id:
        raise HTTPException(400, "No village context")
    v = db.get(Location, village_id)
    t = intel.triage(body.species, body.symptoms, body.dead_count,
                     body.affected_count)
    c = Case(client_uuid=body.client_uuid, village_id=village_id,
             farmer_id=fm.id if fm else None, animal_id=body.animal_id,
             species=body.species, symptoms=",".join(body.symptoms),
             affected_count=body.affected_count, dead_count=body.dead_count,
             onset_date=date.today(), channel=body.channel,
             photo=body.photo, notes=body.notes, lat=v.lat, lon=v.lon,
             triage_band=t["band"], triage_score=t["score"],
             suspected=t["suspected"], zoonotic_flag=t["zoonotic"],
             status="TRIAGED")
    db.add(c); db.flush()
    audit(db, user.id, "report", f"case {c.id} {t['band']}")

    # high-band cases auto-escalate an alert to the vet queue
    if t["band"] == "high":
        db.add(Alert(kind="outbreak" if t["zoonotic"] else "advisory",
                     severity="high",
                     title=f"HIGH triage case #{c.id} in {v.name}",
                     body="; ".join(t["reasons"]), village_id=village_id,
                     target_role="vet"))
    db.commit()

    # re-run intelligence so the new report immediately affects clusters & risk
    intel.refresh_all(db)
    return _case_out(db, c, triage_reasons=t["reasons"])


def _case_out(db, c: Case, triage_reasons=None, dedup=False):
    v = db.get(Location, c.village_id)
    kb = intel.load_kb()
    sus_names = [kb["diseases"][k]["name"]["en"]
                 for k in (c.suspected or "").split(",") if k in kb["diseases"]]
    return {"id": c.id, "village": v.name if v else None,
            "village_id": c.village_id, "species": c.species,
            "symptoms": (c.symptoms or "").split(","),
            "affected_count": c.affected_count, "dead_count": c.dead_count,
            "reported_at": c.reported_at.isoformat() if c.reported_at else None,
            "channel": c.channel, "status": c.status,
            "triage_band": c.triage_band, "triage_score": c.triage_score,
            "suspected": (c.suspected or "").split(",") if c.suspected else [],
            "suspected_names": sus_names, "zoonotic": bool(c.zoonotic_flag),
            "notes": c.notes, "deduplicated": dedup,
            "triage_reasons": triage_reasons,
            "samples": [{"id": s.id, "code": s.code, "status": s.status,
                         "lab_result": s.lab_result,
                         "result_disease": s.result_disease} for s in c.samples]}


@app.get("/api/reports/mine")
def my_reports(user: User = Depends(current_user), db: Session = Depends(get_db)):
    fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
    if not fm:
        return []
    rows = (db.query(Case).filter(Case.farmer_id == fm.id)
              .order_by(Case.reported_at.desc()).limit(20).all())
    return [_case_out(db, c) for c in rows]


# -------------------------------------------------------------------- cases --
@app.get("/api/cases")
def list_cases(status: Optional[str] = None, band: Optional[str] = None,
               days: int = 14, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    q = db.query(Case).filter(
        Case.reported_at >= datetime.utcnow() - timedelta(days=days))
    if status:
        q = q.filter(Case.status == status)
    if band:
        q = q.filter(Case.triage_band == band)
    # scope by role
    if user.role in ("block",) and user.location_id:
        vids = [l.id for l in db.query(Location)
                .filter(Location.parent_id == user.location_id).all()]
        q = q.filter(Case.village_id.in_(vids))
    rows = q.order_by(Case.reported_at.desc()).limit(200).all()
    order = {"high": 0, "medium": 1, "low": 2}
    rows.sort(key=lambda c: (order.get(c.triage_band, 3),))
    return [_case_out(db, c) for c in rows]


class CaseAction(BaseModel):
    action: str            # assign|investigate|treat|escalate|close|confirm|negative
    diagnosis: str = ""
    treatment: str = ""
    escalate_to: str = ""
    withdrawal_days: int = 0   # milk/meat withdrawal after antibiotics


VALID_TRANSITIONS = {
    "assign": ("TRIAGED", "ASSIGNED"), "investigate": ("ASSIGNED", "UNDER_INVESTIGATION"),
    "treat": ("UNDER_INVESTIGATION", "TREATMENT"), "close": ("*", "CLOSED"),
    "escalate": ("*", None), "confirm": ("*", "CONFIRMED"),
}


@app.post("/api/cases/{case_id}/action")
def case_action(case_id: int, body: CaseAction,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Case, case_id)
    if not c:
        raise HTTPException(404, "Case not found")
    a = body.action
    if a == "assign":
        c.status, c.assigned_to = "ASSIGNED", user.id
    elif a == "investigate":
        c.status = "UNDER_INVESTIGATION"
    elif a == "treat":
        c.status = "TREATMENT"
        db.add(Treatment(case_id=c.id, vet_id=user.id,
                         diagnosis=body.diagnosis, treatment=body.treatment,
                         withdrawal_days=max(0, body.withdrawal_days)))
        if body.withdrawal_days > 0 and c.farmer_id:
            fm = db.get(Farmer, c.farmer_id)
            fu = db.get(User, fm.user_id) if fm else None
            for lg, ttl, bd in (
                ("hi", f"दूध बिक्री रोकें — {body.withdrawal_days} दिन",
                       f"केस #{c.id}: दवा के बाद {body.withdrawal_days} दिन दूध/मांस न बेचें "
                       f"(खाद्य सुरक्षा)। तारीख पशुआरोग्य पासपोर्ट में देखें।"),
                ("mr", f"दूध विक्री थांबवा — {body.withdrawal_days} दिवस",
                       f"केस #{c.id}: औषधोपचारानंतर {body.withdrawal_days} दिवस दूध/मांस विकू नका "
                       f"(अन्न सुरक्षा). पशुआरोग्य पासपोर्टमध्ये तारीख पहा."),
                ("en", f"Stop selling milk — {body.withdrawal_days} days",
                       f"Case #{c.id}: milk/meat withdrawal for {body.withdrawal_days} days after "
                       f"treatment (food safety). Date shown on the animal passport.")):
                db.add(Alert(kind="advisory", severity="high", title=f"[{lg}] {ttl}",
                             body=bd, village_id=c.village_id, target_role="farmer", lang=lg))
    elif a == "escalate":
        c.escalated_to = body.escalate_to or "block"
        v = db.get(Location, c.village_id)
        db.add(Alert(kind="outbreak", severity="high",
                     title=f"Case #{c.id} escalated to {c.escalated_to}",
                     body=f"{c.species} case in {v.name}: {c.symptoms}. "
                          f"Escalated by {user.name}.",
                     village_id=c.village_id, target_role=c.escalated_to))
    elif a == "close":
        c.status = "CLOSED"
    elif a == "confirm":
        c.status = "CONFIRMED"
    else:
        raise HTTPException(400, "Unknown action")
    audit(db, user.id, f"case_{a}", f"case {c.id}")
    db.commit()
    return _case_out(db, c)


# ------------------------------------------------------------------ samples --
@app.post("/api/cases/{case_id}/sample")
def collect_sample(case_id: int, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    c = db.get(Case, case_id)
    if not c:
        raise HTTPException(404, "Case not found")
    code = f"MH-{case_id:04d}-{random.randint(1000, 9999)}"
    s = Sample(code=code, case_id=case_id, collected_by=user.id)
    c.status = "SAMPLE_COLLECTED"
    db.add(s); audit(db, user.id, "sample_collect", code); db.commit()
    return {"id": s.id, "code": code, "status": s.status}


@app.get("/api/samples")
def list_samples(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Sample).order_by(Sample.collected_at.desc()).limit(100).all()
    out = []
    for s in rows:
        c = s.case
        v = db.get(Location, c.village_id) if c else None
        out.append({"id": s.id, "code": s.code, "status": s.status,
                    "case_id": s.case_id, "village": v.name if v else None,
                    "species": c.species if c else None,
                    "suspected": c.suspected if c else None,
                    "collected_at": s.collected_at.isoformat(),
                    "lab_result": s.lab_result,
                    "result_disease": s.result_disease})
    return out


class SampleUpdate(BaseModel):
    status: Optional[str] = None
    lab_result: Optional[str] = None
    result_disease: Optional[str] = None


@app.post("/api/samples/{sample_id}")
def update_sample(sample_id: int, body: SampleUpdate,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Sample, sample_id)
    if not s:
        raise HTTPException(404, "Sample not found")
    if body.status:
        s.status = body.status
    if body.lab_result:
        s.status, s.lab_result = "RESULT", body.lab_result
        s.result_disease, s.result_at = body.result_disease, datetime.utcnow()
        c = s.case
        if body.lab_result == "positive" and c:
            c.status = "CONFIRMED"
            v = db.get(Location, c.village_id)
            kb = intel.load_kb()
            dn = kb["diseases"].get(body.result_disease or "", {}) \
                   .get("name", {}).get("en", body.result_disease)
            for role in ("block", "district"):
                db.add(Alert(kind="outbreak", severity="high",
                             title=f"LAB-CONFIRMED {dn} in {v.name}",
                             body=f"Sample {s.code} positive for {dn}. Containment "
                                  f"protocol: movement control + ring vaccination.",
                             village_id=c.village_id, target_role=role))
        elif body.lab_result == "negative" and c:
            c.status = "NEGATIVE"
    audit(db, user.id, "sample_update", f"{s.code} -> {s.status}")
    db.commit()
    return {"id": s.id, "code": s.code, "status": s.status,
            "lab_result": s.lab_result}


# ---------------------------------------------------------------- dashboard --
@app.get("/api/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    total_animals = db.query(func.count(Animal.id)).scalar()
    active_cases = db.query(func.count(Case.id)).filter(
        ~Case.status.in_(["CLOSED", "NEGATIVE"])).scalar()
    cases_7d = db.query(func.count(Case.id)).filter(
        Case.reported_at >= week_ago).scalar()
    deaths_7d = db.query(func.coalesce(func.sum(Case.dead_count), 0)).filter(
        Case.reported_at >= week_ago).scalar()
    high_villages = db.query(func.count(RiskScore.id)).filter(
        RiskScore.band == "high").scalar()
    outbreaks = db.query(func.count(Outbreak.id)).filter(
        Outbreak.status == "ACTIVE").scalar()
    pending_lab = db.query(func.count(Sample.id)).filter(
        Sample.status != "RESULT").scalar()
    # coverage overall
    total = db.query(func.count(Animal.id)).scalar() or 1
    vacc = db.query(func.count(func.distinct(Vaccination.animal_id))).filter(
        Vaccination.given_on >= date.today() - timedelta(days=365)).scalar()
    # median report->awareness lag in hours (reported_at vs onset)
    return {"total_animals": total_animals, "active_cases": active_cases,
            "cases_7d": cases_7d, "deaths_7d": int(deaths_7d),
            "high_risk_villages": high_villages, "active_outbreaks": outbreaks,
            "pending_lab": pending_lab,
            "vaccination_coverage": round(vacc / total, 3)}


@app.get("/api/dashboard/map")
def dashboard_map(level: str = Query("village", pattern="^(village|block|district)$"),
                  db: Session = Depends(get_db)):
    """Risk map at any admin level — the aggregation unit is a parameter,
    not a hardcoded column (judge demand #2)."""
    risks = {r.village_id: r for r in db.query(RiskScore).all()}
    villages = db.query(Location).filter(Location.level == "village").all()

    def vrow(v):
        r = risks.get(v.id)
        return {"id": v.id, "name": v.name, "lat": v.lat, "lon": v.lon,
                "score": r.score if r else 0, "band": r.band if r else "low",
                "reasons": json.loads(r.reasons) if r else [],
                "breakdown": json.loads(r.breakdown) if r else {}}

    if level == "village":
        units = [vrow(v) for v in villages]
    else:
        groups = {}
        for v in villages:
            blk = db.get(Location, v.parent_id)
            key = blk.id if level == "block" else blk.parent_id
            groups.setdefault(key, []).append(vrow(v))
        units = []
        for gid, vs in groups.items():
            g = db.get(Location, gid)
            score = max(x["score"] for x in vs)
            worst = max(vs, key=lambda x: x["score"])
            units.append({"id": g.id, "name": g.name, "lat": g.lat, "lon": g.lon,
                          "score": score,
                          "band": "high" if score >= 60 else
                                  ("moderate" if score >= 35 else "low"),
                          "reasons": [f"worst village: {worst['name']}"] + worst["reasons"],
                          "breakdown": worst["breakdown"], "n_villages": len(vs)})

    clusters = []
    for ob in db.query(Outbreak).filter(Outbreak.status == "ACTIVE").all():
        c = db.get(Location, ob.center_village_id)
        kb = intel.load_kb()
        dn = kb["diseases"].get(ob.suspected or "", {}).get("name", {}).get("en", "?")
        clusters.append({"id": ob.id, "center": c.name, "lat": c.lat, "lon": c.lon,
                         "radius_km": ob.radius_km, "cases_7d": ob.cases_7d,
                         "expected": ob.expected, "p_value": ob.p_value,
                         "suspected": dn, "zoonotic": ob.zoonotic,
                         "detected_at": ob.detected_at.isoformat()})
    return {"level": level, "units": units, "clusters": clusters}


@app.get("/api/dashboard/trends")
def trends(days: int = 21, db: Session = Depends(get_db)):
    now = datetime.utcnow()
    out = []
    for d in range(days, -1, -1):
        day0 = (now - timedelta(days=d)).replace(hour=0, minute=0, second=0, microsecond=0)
        day1 = day0 + timedelta(days=1)
        n = db.query(func.count(Case.id)).filter(
            Case.reported_at >= day0, Case.reported_at < day1).scalar()
        dead = db.query(func.coalesce(func.sum(Case.dead_count), 0)).filter(
            Case.reported_at >= day0, Case.reported_at < day1).scalar()
        out.append({"date": day0.strftime("%d %b"), "cases": n, "deaths": int(dead)})
    # species + disease distribution over the window
    since = now - timedelta(days=days)
    sp = dict(db.query(Case.species, func.count(Case.id))
                .filter(Case.reported_at >= since).group_by(Case.species).all())
    sus = {}
    for (s,) in db.query(Case.suspected).filter(Case.reported_at >= since,
                                                Case.suspected != "").all():
        k = s.split(",")[0]
        sus[k] = sus.get(k, 0) + 1
    kb = intel.load_kb()
    sus_named = {kb["diseases"].get(k, {}).get("name", {}).get("en", k): v
                 for k, v in sus.items()}
    channels = dict(db.query(Case.channel, func.count(Case.id))
                      .filter(Case.reported_at >= since)
                      .group_by(Case.channel).all())
    return {"daily": out, "species": sp, "suspected": sus_named,
            "channels": channels}


@app.get("/api/dashboard/vaccination")
def vaccination_coverage(db: Session = Depends(get_db)):
    out = []
    for blk in db.query(Location).filter(Location.level == "block").all():
        vids = [v.id for v in blk.children if v.level == "village"]
        total = db.query(func.count(Animal.id)).filter(
            Animal.village_id.in_(vids)).scalar() or 0
        done = db.query(func.count(func.distinct(Vaccination.animal_id))).filter(
            Vaccination.village_id.in_(vids),
            Vaccination.given_on >= date.today() - timedelta(days=365)).scalar() or 0
        dist = db.get(Location, blk.parent_id)
        out.append({"block": blk.name, "district": dist.name,
                    "animals": total, "vaccinated": done,
                    "coverage": round(done / total, 3) if total else 0})
    out.sort(key=lambda x: x["coverage"])
    return out


@app.get("/api/dashboard/timeline/{outbreak_id}")
def outbreak_timeline(outbreak_id: int, db: Session = Depends(get_db)):
    ob = db.get(Outbreak, outbreak_id)
    if not ob:
        raise HTTPException(404, "Outbreak not found")
    vids = json.loads(ob.zone_village_ids or "[]")
    cases = (db.query(Case).filter(Case.village_id.in_(vids))
               .order_by(Case.reported_at).limit(300).all())
    events = []
    for c in cases:
        v = db.get(Location, c.village_id)
        events.append({"at": c.reported_at.isoformat(), "kind": "report",
                       "text": f"{c.species} case in {v.name} "
                               f"({c.triage_band} triage, via {c.channel})"
                               + (f" — {c.dead_count} death(s)" if c.dead_count else "")})
        for s in c.samples:
            events.append({"at": s.collected_at.isoformat(), "kind": "sample",
                           "text": f"Sample {s.code} collected ({v.name})"})
            if s.result_at:
                events.append({"at": s.result_at.isoformat(), "kind": "lab",
                               "text": f"Lab result {s.code}: {s.lab_result} "
                                       f"({s.result_disease or ''})"})
    events.append({"at": ob.detected_at.isoformat(), "kind": "detect",
                   "text": f"Outbreak Radar flagged cluster "
                           f"(obs {ob.cases_7d} vs exp {ob.expected}, p={ob.p_value})"})
    events.sort(key=lambda e: e["at"])
    return {"outbreak": {"id": ob.id, "suspected": ob.suspected,
                         "status": ob.status}, "events": events}


# ------------------------------------------------------------------- alerts --
@app.get("/api/alerts")
def get_alerts(role: Optional[str] = None, lang: Optional[str] = None,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Alert).order_by(Alert.created_at.desc())
    target = role or user.role
    if target == "district":
        q = q.filter(Alert.target_role.in_(["district", "block", "health"]))
    elif target == "state":
        pass  # state sees everything
    else:
        q = q.filter(Alert.target_role == target)
    if lang and target == "farmer":
        q = q.filter(Alert.lang.in_([lang, "en"]))
    rows = q.limit(60).all()
    out = []
    for a in rows:
        v = db.get(Location, a.village_id) if a.village_id else None
        out.append({"id": a.id, "kind": a.kind, "severity": a.severity,
                    "title": a.title, "body": a.body, "lang": a.lang,
                    "village": v.name if v else None,
                    "target_role": a.target_role,
                    "created_at": a.created_at.isoformat(),
                    "acknowledged": a.acknowledged})
    return out


@app.post("/api/alerts/{alert_id}/ack")
def ack_alert(alert_id: int, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if a:
        a.acknowledged = True
        audit(db, user.id, "alert_ack", str(alert_id)); db.commit()
    return {"ok": True}


# ------------------------------------------------------------- intelligence --
@app.post("/api/detect/run")
def detect_run(user: User = Depends(current_user), db: Session = Depends(get_db)):
    obs = intel.refresh_all(db)
    audit(db, user.id, "detect_run", f"{len(obs)} clusters"); db.commit()
    return {"clusters": len(obs)}


@app.get("/api/risk/{village_id}")
def village_risk(village_id: int, db: Session = Depends(get_db)):
    r = db.query(RiskScore).filter(RiskScore.village_id == village_id).first()
    v = db.get(Location, village_id)
    if not r or not v:
        raise HTTPException(404, "No risk computed")
    return {"village": v.name, "score": r.score, "band": r.band,
            "reasons": json.loads(r.reasons), "breakdown": json.loads(r.breakdown),
            "computed_at": r.computed_at.isoformat()}


@app.post("/api/weather/refresh")
def weather_refresh(user: User = Depends(current_user), db: Session = Depends(get_db)):
    res = wx.refresh_district_sample(db)
    intel.compute_risk(db)
    return {"blocks_updated": list(res.keys()),
            "note": "risk recomputed with fresh weather signal"}


# ---------------------------------------------------------- claims (farmer) --
# Govt compensation schedule (demo figures aligned to NDRF/state norms)
CLAIM_AMOUNTS = {"cattle": 37500, "buffalo": 37500, "goat": 4000,
                 "sheep": 4000, "poultry": 100}


class ClaimIn(BaseModel):
    case_id: int


@app.post("/api/claims")
def file_claim(body: ClaimIn, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
    if not fm:
        raise HTTPException(403, "Farmer profile required")
    c = db.get(Case, body.case_id)
    if not c or c.farmer_id != fm.id:
        raise HTTPException(404, "Case not found for this farmer")
    if not c.dead_count and c.status != "CONFIRMED":
        raise HTTPException(400, "Claim requires a reported death or a confirmed case")
    dup = db.query(Claim).filter(Claim.case_id == c.id).first()
    if dup:
        return _claim_out(db, dup)
    animal = db.get(Animal, c.animal_id) if c.animal_id else None
    cl = Claim(case_id=c.id, farmer_id=fm.id,
               animal_tag=animal.tag_id if animal else None,
               species=c.species, amount=CLAIM_AMOUNTS.get(c.species, 4000))
    db.add(cl); db.flush()
    v = db.get(Location, c.village_id)
    db.add(Alert(kind="advisory", severity="medium",
                 title=f"Compensation claim #{cl.id} filed — {v.name}",
                 body=f"{user.name}: {c.species} death, case #{c.id}, "
                      f"₹{cl.amount:,}. Verify against case record & lab status.",
                 village_id=c.village_id, target_role="district"))
    audit(db, user.id, "claim_filed", f"claim {cl.id} case {c.id}")
    db.commit()
    return _claim_out(db, cl)


def _claim_out(db, cl: Claim):
    c = db.get(Case, cl.case_id)
    v = db.get(Location, c.village_id) if c else None
    fu = db.get(User, cl.farmer.user_id) if cl.farmer else None
    return {"id": cl.id, "case_id": cl.case_id, "species": cl.species,
            "animal_tag": cl.animal_tag, "amount": cl.amount,
            "status": cl.status, "filed_at": cl.filed_at.isoformat(),
            "decided_at": cl.decided_at.isoformat() if cl.decided_at else None,
            "note": cl.note, "village": v.name if v else None,
            "farmer": fu.name if fu else None,
            "case_status": c.status if c else None}


@app.get("/api/claims/mine")
def my_claims(user: User = Depends(current_user), db: Session = Depends(get_db)):
    fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
    if not fm:
        return []
    rows = (db.query(Claim).filter(Claim.farmer_id == fm.id)
              .order_by(Claim.filed_at.desc()).all())
    return [_claim_out(db, cl) for cl in rows]


@app.get("/api/claims")
def all_claims(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("block", "district", "state"):
        raise HTTPException(403, "Officials only")
    rows = db.query(Claim).order_by(Claim.filed_at.desc()).limit(200).all()
    return [_claim_out(db, cl) for cl in rows]


class ClaimDecision(BaseModel):
    decision: str          # UNDER_REVIEW|APPROVED|PAID|REJECTED
    note: str = ""


@app.post("/api/claims/{claim_id}/decide")
def decide_claim(claim_id: int, body: ClaimDecision,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("block", "district", "state"):
        raise HTTPException(403, "Officials only")
    cl = db.get(Claim, claim_id)
    if not cl:
        raise HTTPException(404, "Claim not found")
    if body.decision not in ("UNDER_REVIEW", "APPROVED", "PAID", "REJECTED"):
        raise HTTPException(400, "Bad decision")
    cl.status, cl.note = body.decision, body.note
    cl.decided_at = datetime.utcnow()
    audit(db, user.id, "claim_decide", f"claim {cl.id} -> {body.decision}")
    db.commit()
    return _claim_out(db, cl)


# ------------------------------------------------------------- action queue --
@app.get("/api/tasks")
def list_tasks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Task).order_by(Task.status.desc(), Task.created_at.desc())
    rows = q.limit(100).all()
    out = []
    for t in rows:
        v = db.get(Location, t.village_id) if t.village_id else None
        out.append({"id": t.id, "kind": t.kind, "title": t.title,
                    "village": v.name if v else None,
                    "assigned_role": t.assigned_role, "status": t.status,
                    "created_at": t.created_at.isoformat(),
                    "done_at": t.done_at.isoformat() if t.done_at else None})
    order = {"OPEN": 0, "IN_PROGRESS": 1, "DONE": 2}
    out.sort(key=lambda x: (order.get(x["status"], 3), x["created_at"]))
    return out


class TaskUpdate(BaseModel):
    status: str


@app.post("/api/tasks/{task_id}")
def update_task(task_id: int, body: TaskUpdate,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if body.status not in ("OPEN", "IN_PROGRESS", "DONE"):
        raise HTTPException(400, "Bad status")
    t.status = body.status
    t.done_at = datetime.utcnow() if body.status == "DONE" else None
    audit(db, user.id, "task_update", f"task {t.id} -> {body.status}")
    db.commit()
    return {"id": t.id, "status": t.status}


# -------------------------------------------------------- vaccination camps --
@app.get("/api/camps")
def list_camps(mine: bool = False, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    q = db.query(Camp).filter(Camp.camp_date >= date.today() - timedelta(days=2))
    if mine:
        fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
        if fm:
            v = db.get(Location, fm.village_id)
            sibling_ids = [x.id for x in db.query(Location)
                           .filter(Location.parent_id == v.parent_id).all()]
            q = q.filter(Camp.village_id.in_(sibling_ids))
    rows = q.order_by(Camp.camp_date).limit(50).all()
    kb = intel.load_kb()
    out = []
    for cp in rows:
        v = db.get(Location, cp.village_id)
        blk = db.get(Location, v.parent_id) if v else None
        dn = kb["diseases"].get(cp.disease_key or "", {}).get("name", {})
        out.append({"id": cp.id, "village": v.name if v else None,
                    "block": blk.name if blk else None,
                    "disease": cp.disease_key,
                    "disease_name": dn.get("en", cp.disease_key),
                    "disease_name_mr": dn.get("mr", ""),
                    "date": str(cp.camp_date), "name": cp.name,
                    "status": cp.status})
    return out


class CampIn(BaseModel):
    village_id: int
    disease_key: str
    camp_date: str          # YYYY-MM-DD
    name: str = ""


@app.post("/api/camps")
def create_camp(body: CampIn, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    if user.role not in ("block", "district", "state"):
        raise HTTPException(403, "Officials only")
    v = db.get(Location, body.village_id)
    if not v:
        raise HTTPException(404, "Village not found")
    kb = intel.load_kb()
    dn = kb["diseases"].get(body.disease_key, {}).get("name", {}).get("en",
                                                                     body.disease_key)
    cp = Camp(village_id=body.village_id, disease_key=body.disease_key,
              camp_date=date.fromisoformat(body.camp_date),
              name=body.name or f"{dn} vaccination camp — {v.name}")
    db.add(cp); db.flush()
    act = kb["diseases"].get(body.disease_key, {})
    for lang, txt in (("hi", f"टीकाकरण शिविर: {v.name} में {cp.camp_date:%d/%m/%Y} को "
                             f"{act.get('name', {}).get('hi', dn)} टीका मुफ़्त। अपने पशु लेकर आएं।"),
                      ("mr", f"लसीकरण शिबिर: {v.name} येथे {cp.camp_date:%d/%m/%Y} रोजी "
                             f"{act.get('name', {}).get('mr', dn)} लस मोफत. आपली जनावरे घेऊन या."),
                      ("en", f"Vaccination camp at {v.name} on {cp.camp_date:%d %b %Y} — "
                             f"free {dn} vaccine. Bring your animals.")):
        db.add(Alert(kind="vaccination", severity="medium",
                     title=f"[{lang}] {dn} camp — {v.name}",
                     body=txt, village_id=v.id, target_role="farmer", lang=lang))
    audit(db, user.id, "camp_create", f"camp {cp.id} {v.name}")
    db.commit()
    return {"id": cp.id, "name": cp.name, "date": str(cp.camp_date)}


# ---------------------------------------------------------- farmer weather --
@app.get("/api/myweather")
def my_weather(user: User = Depends(current_user), db: Session = Depends(get_db)):
    fm = db.query(Farmer).filter(Farmer.user_id == user.id).first()
    vid = fm.village_id if fm else user.location_id
    if not vid:
        raise HTTPException(400, "No village context")
    v = db.get(Location, vid)
    w = wx.refresh_village_weather(db, v)
    return {"village": v.name, "weather": w}


# -------------------------------------------------------------- CSV exports --
from fastapi.responses import Response


@app.get("/api/export/{what}.csv")
def export_csv(what: str, db: Session = Depends(get_db)):
    import io, csv
    buf = io.StringIO()
    w = csv.writer(buf)
    if what == "cases":
        w.writerow(["id", "village", "species", "symptoms", "affected", "dead",
                    "triage", "suspected", "status", "channel", "reported_at"])
        for c in db.query(Case).order_by(Case.reported_at.desc()).limit(2000):
            v = db.get(Location, c.village_id)
            w.writerow([c.id, v.name if v else "", c.species, c.symptoms,
                        c.affected_count, c.dead_count, c.triage_band,
                        c.suspected, c.status, c.channel, c.reported_at])
    elif what == "claims":
        w.writerow(["id", "case_id", "species", "amount", "status", "filed_at"])
        for cl in db.query(Claim).all():
            w.writerow([cl.id, cl.case_id, cl.species, cl.amount, cl.status,
                        cl.filed_at])
    elif what == "vaccination":
        w.writerow(["block", "district", "animals", "vaccinated", "coverage"])
        for r in vaccination_coverage(db):
            w.writerow([r["block"], r["district"], r["animals"],
                        r["vaccinated"], r["coverage"]])
    else:
        raise HTTPException(404, "Unknown export")
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition":
                             f"attachment; filename=pashuraksha_{what}.csv"})



@app.get("/api/hostinfo")
def hostinfo():
    """LAN addresses so a phone on the same Wi-Fi can open the app."""
    import socket
    urls = []
    try:
        s_ = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s_.connect(("8.8.8.8", 80))
        urls.append(f"http://{s_.getsockname()[0]}:8000")
        s_.close()
    except Exception:
        pass
    return {"urls": urls}


# ------------------------------------------ Pashu Lens: AI identification --
# Proxies to the PashuPehchaan breed-recognition sidecar (EfficientNetV2,
# 50 Indian cattle/buffalo breeds, subject + quality gates). Degrades honestly.
import urllib.request, urllib.error

BREED_MR = {
    "Gir_Cow": "गीर", "GirCross": "गीर संकर", "Khillari": "खिल्लार", "Deoni": "देवणी",
    "Dangi": "डांगी", "Red_sindhi": "लाल सिंधी", "Sahiwal": "साहिवाल",
    "SahiwalCross": "साहिवाल संकर", "HFCross": "एच.एफ. संकर", "Holstein_friesian": "होल्स्टिन फ्रिजियन",
    "JerseyCross": "जर्सी संकर", "jersey": "जर्सी", "Kankrej": "कांकरेज", "Tharparkar": "थारपारकर",
    "Ongole": "ओंगोल", "hariana": "हरियाणा", "Rathi": "राठी", "Hallikar": "हल्लीकर",
    "amritmahal": "अमृतमहल", "Murrah": "मुऱ्हा", "Pandharpuri": "पंढरपुरी", "Nagpuri": "नागपुरी",
    "Jafrabadi": "जाफराबादी", "Surti": "सुरती", "Mehsana": "मेहसाणा", "Nili_Ravi": "नीली रावी",
    "Banni": "बन्नी", "Bhadwari": "भदावरी", "Toda": "तोडा", "Red_Dane": "रेड डेन",
    "Brown_Swiss": "ब्राउन स्विस", "Gurnesey": "ग्वेर्न्सी", "Aryshire": "आयरशायर",
    "Kenkatha": "केनकथा", "Kherigarh": "खेरीगढ", "Gangatiri": "गंगातिरी", "Malnad_gidda": "मलनाड गिड्डा",
    "vechur": "वेचूर", "kangyam": "कांगायम", "pulikulam": "पुलिकुलम", "Umblachery": "उंबलाचेरी",
    "krishna_valley": "कृष्णा व्हॅली", "nagori": "नागोरी", "nimari": "निमारी", "bargur_cow": "बारगूर",
    "Binjharpuri": "बिंझारपुरी", "Badri_cow": "बद्री", "Ladakhi_cow": "लडाखी", "Kasargod": "कासरगोड",
    "Girlando": "गिरलांडो",
}


def _pretty_breed(label: str):
    return label.replace("_", " ").replace(" cow", "").replace(" Cow", "").strip().title()


def _ai_get(path, timeout=3):
    with urllib.request.urlopen(AI_URL + path, timeout=timeout) as r:
        return json.loads(r.read().decode())


@app.get("/api/ai/status")
def ai_status():
    try:
        h = _ai_get("/health")
        return {"available": True, "model_loaded": h.get("model_loaded"),
                "model_version": h.get("model_version"), "labels": h.get("labels"),
                "gate": (h.get("subject_gate") or {}).get("loaded")}
    except Exception as e:
        return {"available": False, "model_loaded": False, "error": str(e)[:120]}


class IdentifyIn(BaseModel):
    image: str


@app.post("/api/ai/identify")
def ai_identify(body: IdentifyIn, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    try:
        req = urllib.request.Request(
            AI_URL + "/predict", data=json.dumps({"image": body.image}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read().decode())
    except Exception as e:
        return {"success": False, "available": False,
                "error": "AI identification service is not running on this server.",
                "detail": str(e)[:160]}
    res["available"] = True
    if res.get("success"):
        sp = {"cow": "cattle", "buffalo": "buffalo"}.get(res.get("species"), "cattle")
        conf = float(res.get("best_confidence") or 0)
        res["species_app"] = sp
        res["band"] = "high" if conf >= 0.7 else ("medium" if conf >= 0.45 else "low")
        for c in res.get("top3", []):
            c["label"] = _pretty_breed(c["breed"])
            c["label_mr"] = BREED_MR.get(c["breed"], _pretty_breed(c["breed"]))
            c["species_app"] = {"cow": "cattle", "buffalo": "buffalo"}.get(c.get("species"), "cattle")
        res["best_label"] = _pretty_breed(res.get("best_breed") or "")
        res["best_label_mr"] = BREED_MR.get(res.get("best_breed"), res["best_label"])
        audit(db, user.id, "ai_identify",
              f"{res.get('best_breed')} {round(conf, 2)}"); db.commit()
    return res


# ---------------------------------------------- forecast / what-if planner --
@app.get("/api/forecast")
def forecast_api(days: int = 7, ring_km: float = 12.0,
                 outbreak_id: Optional[int] = None,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    days = max(3, min(14, days))
    return fc.compare(db, days=days, ring_km=ring_km, outbreak_id=outbreak_id)


# --------------------------------------------- animal health passport (public)
@app.get("/api/passport/{tag}")
def passport(tag: str, db: Session = Depends(get_db)):
    a = db.query(Animal).filter(Animal.tag_id == tag).first()
    if not a:
        raise HTTPException(404, "No animal with this tag")
    v = db.get(Location, a.village_id)
    blk = db.get(Location, v.parent_id) if v else None
    dist = db.get(Location, blk.parent_id) if blk else None
    fm = db.get(Farmer, a.farmer_id) if a.farmer_id else None
    owner = db.get(User, fm.user_id) if fm else None
    kb = intel.load_kb()
    vaccs = (db.query(Vaccination).filter(Vaccination.animal_id == a.id)
               .order_by(Vaccination.given_on.desc()).all())
    cases = (db.query(Case).filter(Case.animal_id == a.id)
               .order_by(Case.reported_at.desc()).all())
    treatments = []
    for c in cases:
        for tr in db.query(Treatment).filter(Treatment.case_id == c.id).all():
            treatments.append({"case_id": c.id, "diagnosis": tr.diagnosis,
                               "treatment": tr.treatment,
                               "given_at": tr.given_at.isoformat(),
                               "withdrawal_days": tr.withdrawal_days or 0})
    return {
        "tag_id": a.tag_id, "species": a.species, "breed": a.breed, "sex": a.sex,
        "age_months": a.age_months,
        "owner": (owner.name.split(" ")[0] + " " + owner.name.split(" ")[-1][:1] + ".")
                 if owner and " " in owner.name else (owner.name if owner else None),
        "village": v.name if v else None, "block": blk.name if blk else None,
        "district": dist.name if dist else None,
        "vaccinations": [{"disease": x.disease_key,
                          "disease_name": kb["diseases"].get(x.disease_key, {})
                                            .get("name", {}).get("en", x.disease_key),
                          "disease_name_mr": kb["diseases"].get(x.disease_key, {})
                                            .get("name", {}).get("mr", ""),
                          "disease_name_hi": kb["diseases"].get(x.disease_key, {})
                                            .get("name", {}).get("hi", ""),
                          "given_on": str(x.given_on), "due_on": str(x.due_on),
                          "campaign": x.campaign} for x in vaccs],
        "cases": [{"id": c.id, "status": c.status, "symptoms": c.symptoms,
                   "reported_at": c.reported_at.isoformat(),
                   "suspected": c.suspected} for c in cases[:5]],
        "treatments": treatments[:5],
        "withdrawal": _withdrawal_status(db, a.id),
        "permit": _permit_status(db, a.village_id, a.id),
        "verified_at": datetime.utcnow().isoformat(),
    }


# ------------------------------------------------------------------ SITREP --
@app.get("/api/sitrep")
def sitrep(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("block", "district", "state"):
        raise HTTPException(403, "Officials only")
    summ = dashboard_summary(db)
    mp = dashboard_map("village", db)
    tasks_ = list_tasks(user, db)
    claims_ = all_claims(user, db)
    vacc = vaccination_coverage(db)
    alerts_ = get_alerts(None, None, user, db)
    fcst = fc.compare(db, days=7, ring_km=12.0)["summary"]
    return {"generated_at": datetime.utcnow().isoformat(), "by": user.name,
            "role": user.role, "summary": summ, "clusters": mp["clusters"],
            "high_risk": [u for u in mp["units"] if u["band"] == "high"][:15],
            "tasks_open": [t for t in tasks_ if t["status"] != "DONE"][:20],
            "claims": {"pending": sum(1 for c in claims_ if c["status"] in ("FILED", "UNDER_REVIEW")),
                       "approved": sum(1 for c in claims_ if c["status"] in ("APPROVED", "PAID")),
                       "amount_approved": sum(c["amount"] for c in claims_
                                              if c["status"] in ("APPROVED", "PAID"))},
            "vaccination": vacc, "alerts": alerts_[:10], "forecast": fcst}


# --------------------------------------------------------------------- demo --
@app.post("/api/demo/advance")
def demo_advance(user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = seeder.advance_outbreak_day(db)
    intel.refresh_all(db)
    audit(db, user.id, "demo_advance", f"+{n} cases"); db.commit()
    return {"new_cases": n}


@app.get("/api/audit")
def audit_log(db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.at.desc()).limit(50).all()
    users = {u.id: u.name for u in db.query(User).all()}
    return [{"at": r.at.isoformat(), "user": users.get(r.user_id, "?"),
             "action": r.action, "detail": r.detail} for r in rows]


# ----------------------------------------------------------------- frontend --
FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "frontend")
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
