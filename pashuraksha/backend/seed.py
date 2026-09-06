"""Seed data + synthetic outbreak simulator — statewide demo edition.

Five real Maharashtra districts, ~70 villages, and THREE concurrent
disease storylines so every screen is alive on first load:

  1. LSD wave        — Ahmednagar (Shevgaon origin), 10 days in, growing.
                       Vaccination gap in Shevgaon/Pathardi explains it.
  2. FMD cluster     — Jalgaon (Chalisgaon), 6 days in, market-linked.
  3. Anthrax event   — Nashik (Sinnar), 4 days, ZOONOTIC → One Health flag.
  + PPR background in Solapur goats, routine noise statewide.

Pre-seeded workflow artefacts: samples across the whole chain
(COLLECTED→TESTING→RESULT), one lab-confirmed LSD case, treatments,
closed cases — so vet & lab screens are populated before the demo starts.
`advance_outbreak_day()` injects one more day of spread on demand.
"""
import random
from datetime import datetime, date, timedelta

from models import (Location, User, Farmer, Animal, Case, Vaccination,
                    Treatment, Sample, Alert, Claim, Camp)
from engine import triage, haversine_km

rng = random.Random(2026)

# ---------------------------------------------------------------- geography --
GEO = {
    "Ahmednagar": {"mr": "अहमदनगर", "lat": 19.09, "lon": 74.74, "blocks": {
        "Shevgaon":  {"mr": "शेवगाव",  "lat": 19.35, "lon": 75.23},
        "Pathardi":  {"mr": "पाथर्डी",  "lat": 19.17, "lon": 75.18},
        "Nevasa":    {"mr": "नेवासा",   "lat": 19.55, "lon": 74.93},
        "Rahuri":    {"mr": "राहुरी",   "lat": 19.39, "lon": 74.65},
        "Sangamner": {"mr": "संगमनेर", "lat": 19.57, "lon": 74.21},
    }},
    "Jalgaon": {"mr": "जळगाव", "lat": 21.00, "lon": 75.57, "blocks": {
        "Chalisgaon": {"mr": "चाळीसगाव", "lat": 20.46, "lon": 75.01},
        "Bhusawal":   {"mr": "भुसावळ",   "lat": 21.05, "lon": 75.79},
        "Erandol":    {"mr": "एरंडोल",   "lat": 20.92, "lon": 75.33},
    }},
    "Nashik": {"mr": "नाशिक", "lat": 20.00, "lon": 73.79, "blocks": {
        "Sinnar":   {"mr": "सिन्नर",   "lat": 19.85, "lon": 74.00},
        "Niphad":   {"mr": "निफाड",   "lat": 20.08, "lon": 74.11},
        "Malegaon": {"mr": "मालेगाव", "lat": 20.55, "lon": 74.53},
    }},
    "Pune": {"mr": "पुणे", "lat": 18.52, "lon": 73.86, "blocks": {
        "Junnar":   {"mr": "जुन्नर",   "lat": 19.20, "lon": 73.88},
        "Shirur":   {"mr": "शिरूर",   "lat": 18.83, "lon": 74.37},
        "Baramati": {"mr": "बारामती", "lat": 18.15, "lon": 74.58},
    }},
    "Solapur": {"mr": "सोलापूर", "lat": 17.66, "lon": 75.90, "blocks": {
        "Barshi":      {"mr": "बार्शी",     "lat": 18.23, "lon": 75.69},
        "Pandharpur":  {"mr": "पंढरपूर",  "lat": 17.68, "lon": 75.33},
    }},
}

VILLAGE_NAMES = [
    "Amrapur", "Bodhegaon", "Chapadgaon", "Dahigaon", "Erandgaon", "Ghotan",
    "Hingangaon", "Jategaon", "Kharadgaon", "Ladjalgaon", "Malegaon Kh.",
    "Nimbodi", "Palshi", "Ranjani", "Sonai", "Talegaon", "Ukkadgaon",
    "Vambori", "Warkhed", "Yesgaon", "Belapur", "Chincholi", "Deolali",
    "Fattepur", "Gondegaon", "Hiwargaon", "Jambhali", "Kolgaon", "Loni Bk.",
    "Mirajgaon", "Nandur", "Owe", "Pimpalgaon", "Rui", "Shirasgaon",
    "Takli", "Undirgaon", "Vadgaon", "Wakadi", "Yeola Kh.", "Ambegaon",
    "Bhalwani", "Chikhali", "Dhamori", "Ekalahare", "Ghodegaon", "Hivare",
    "Jawala", "Kandhar", "Limbodi", "Mhasrul", "Nagapur", "Ozar",
    "Pargaon", "Rajur", "Sawargaon", "Tandulwadi", "Umbraj", "Velapur",
    "Wadner", "Yenere", "Ashti Kh.", "Borgaon", "Chandgaon", "Daund Kh.",
    "Eklara", "Gunjalwadi", "Hatgaon", "Jamgaon", "Kasari", "Lohgaon",
]

FARMER_NAMES = [
    "Ramesh Pawar", "Suresh Jadhav", "Vithal Shinde", "Bhaskar More",
    "Kailas Gaikwad", "Dattatray Kale", "Sanjay Thorat", "Prakash Deshmukh",
    "Nanda Patil", "Savita Kharat", "Ashok Chavan", "Baban Shelar",
    "Ganesh Wagh", "Popat Kadam", "Shantabai Jagtap", "Uttam Bhosale",
    "Maruti Salunkhe", "Vandana Ghule", "Tukaram Dhole", "Sopan Zende",
    "Lata Nikam", "Eknath Raut", "Chhaya Sable", "Dnyaneshwar Lokhande",
]

SPECIES_MIX = [("cattle", 0.42), ("buffalo", 0.2), ("goat", 0.24),
               ("sheep", 0.09), ("poultry", 0.05)]
BREEDS = {"cattle": ["Gir", "Khillar", "HF cross", "Jersey cross", "Deoni", "Red Kandhari"],
          "buffalo": ["Murrah", "Pandharpuri", "Jaffarabadi", "Nagpuri"],
          "goat": ["Osmanabadi", "Sangamneri", "Boer cross", "Berari"],
          "sheep": ["Deccani", "Madgyal"], "poultry": ["Desi", "Giriraja"]}


def _pick_species():
    r = rng.random(); acc = 0
    for sp, w in SPECIES_MIX:
        acc += w
        if r <= acc:
            return sp
    return "cattle"


def seed_all(db):
    if db.query(Location).count():
        return False

    lgd = 500000
    villages, by_block = [], {}
    vname = iter(VILLAGE_NAMES * 3)
    for dname, d in GEO.items():
        dist = Location(name=dname, name_mr=d["mr"], level="district",
                        lgd_code=str(lgd := lgd + 1), lat=d["lat"], lon=d["lon"])
        db.add(dist); db.flush()
        for bname, b in d["blocks"].items():
            blk = Location(name=bname, name_mr=b["mr"], level="block",
                           lgd_code=str(lgd := lgd + 1), parent_id=dist.id,
                           lat=b["lat"], lon=b["lon"])
            db.add(blk); db.flush()
            by_block[bname] = []
            for i in range(4 if bname not in ("Shevgaon", "Chalisgaon") else 5):
                v = Location(name=next(vname), level="village",
                             lgd_code=str(lgd := lgd + 1), parent_id=blk.id,
                             lat=b["lat"] + rng.uniform(-0.085, 0.085),
                             lon=b["lon"] + rng.uniform(-0.085, 0.085))
                db.add(v); villages.append(v); by_block[bname].append(v)
    db.flush()

    # ------------------------------------------------------------- users -----
    home = by_block["Shevgaon"][0]
    ahm = db.query(Location).filter_by(name="Ahmednagar").first()
    demo_users = [
        ("9000000001", "Ramesh Pawar", "farmer", home.id, "hi"),
        ("9000000002", "Sunil Kamble", "field", home.parent_id, "hi"),
        ("9000000003", "Dr. Meera Kulkarni", "vet", home.parent_id, "en"),
        ("9000000004", "Anil Sathe", "lab", None, "en"),
        ("9000000005", "B.V.O. Shevgaon", "block", home.parent_id, "en"),
        ("9000000006", "D.V.O. Ahmednagar", "district", ahm.id, "en"),
        ("9000000007", "State Admin", "state", None, "en"),
    ]
    for phone, name, role, loc, lang in demo_users:
        db.add(User(phone=phone, name=name, role=role, location_id=loc, lang=lang))
    db.flush()
    demo_farmer_user = db.query(User).filter_by(phone="9000000001").first()

    # ------------------------------------------------- farmers & animals -----
    tag_seq = 100000000001
    for idx, v in enumerate(villages):
        for j in range(rng.randint(2, 4)):
            if idx == 0 and j == 0:
                u = demo_farmer_user
            else:
                u = User(phone=f"98{rng.randint(10000000, 99999999)}",
                         name=rng.choice(FARMER_NAMES), role="farmer",
                         location_id=v.id, lang="hi")
                db.add(u); db.flush()
            fm = Farmer(user_id=u.id, village_id=v.id)
            db.add(fm); db.flush()
            for _ in range(rng.randint(2, 6)):
                sp = _pick_species()
                db.add(Animal(tag_id=f"IN{tag_seq}", species=sp,
                              breed=rng.choice(BREEDS[sp]),
                              sex=rng.choice(["F", "F", "F", "M"]),
                              age_months=rng.randint(8, 110),
                              farmer_id=fm.id, village_id=v.id))
                tag_seq += 1
    db.flush()

    # ------------------------------------------------------ vaccinations -----
    today = date.today()
    LOW_COV = {"Shevgaon": 0.34, "Pathardi": 0.38, "Chalisgaon": 0.46}
    for v in villages:
        blk = db.get(Location, v.parent_id)
        cov = LOW_COV.get(blk.name, rng.uniform(0.62, 0.92))
        for a in db.query(Animal).filter(Animal.village_id == v.id).all():
            if rng.random() < cov:
                given = today - timedelta(days=rng.randint(25, 330))
                db.add(Vaccination(animal_id=a.id, village_id=v.id,
                                   disease_key=rng.choice(["fmd", "lsd", "hs", "ppr"]),
                                   vaccine="Govt campaign",
                                   given_on=given, due_on=given + timedelta(days=365),
                                   campaign="LHDCP 2026"))
    db.flush()

    # ------------------------------------------------------- storylines ------
    now = datetime.utcnow()
    _background_noise(db, villages, days=28)

    # 1. LSD wave in Ahmednagar — 10 days, biggest story
    for day in range(10):
        _wave_day(db, by_block["Shevgaon"] + by_block["Pathardi"] +
                  by_block["Nevasa"] + by_block["Rahuri"],
                  origin=by_block["Shevgaon"][0], day=day,
                  when=now - timedelta(days=10 - day),
                  syndromes=["fever", "nodules", "low_milk", "anorexia"],
                  species=["cattle", "cattle", "buffalo"], horizon_km=28,
                  growth=0.13, base=0.16, death_after=5, death_p=0.12,
                  key_sym="nodules")

    # 2. FMD cluster in Jalgaon (Chalisgaon) — 6 days, market-linked
    for day in range(6):
        _wave_day(db, by_block["Chalisgaon"] + by_block["Erandol"],
                  origin=by_block["Chalisgaon"][0], day=day,
                  when=now - timedelta(days=6 - day),
                  syndromes=["oral_lesions", "hoof_lesions", "salivation",
                             "fever", "lameness"],
                  species=["cattle", "buffalo", "cattle"], horizon_km=20,
                  growth=0.15, base=0.2, death_after=99, death_p=0,
                  key_sym="oral_lesions")

    # 3. Anthrax — Nashik (Sinnar): 6 sudden-death cases in 2 NEARBY villages
    sinnar = by_block["Sinnar"]
    origin = sinnar[0]
    nearest = min(sinnar[1:], key=lambda w: haversine_km(origin.lat, origin.lon,
                                                         w.lat, w.lon))
    pair = [origin, nearest]
    for i in range(6):
        v = pair[i % 2]
        when = now - timedelta(days=rng.uniform(0.3, 4), hours=rng.randint(0, 8))
        _mk_case(db, v, "cattle", ["sudden_death", "bloat", "fever"][:rng.randint(2, 3)],
                 dead=1, when=when, channel=rng.choice(["field", "ivr", "app"]))

    # 4. PPR whisper in Solapur goats (below cluster threshold — background)
    for i in range(3):
        v = rng.choice(by_block["Barshi"] + by_block["Pandharpur"])
        _mk_case(db, v, "goat", ["diarrhoea", "fever", "oral_lesions"], 0,
                 now - timedelta(days=rng.uniform(1, 6)))

    db.flush()

    # ------------------------------------- pre-seeded workflow artefacts -----
    vet = db.query(User).filter_by(role="vet").first()
    lab = db.query(User).filter_by(role="lab").first()
    lsd_cases = (db.query(Case).filter(Case.suspected.like("lsd%"))
                   .order_by(Case.reported_at).limit(8).all())
    stages = ["RESULT", "TESTING", "RECEIVED", "DISPATCHED", "COLLECTED"]
    for i, c in enumerate(lsd_cases[:5]):
        code = f"MH-{c.id:04d}-{rng.randint(1000, 9999)}"
        st = stages[i]
        s = Sample(code=code, case_id=c.id, collected_by=vet.id,
                   collected_at=c.reported_at + timedelta(hours=rng.randint(4, 20)),
                   status=st)
        if st == "RESULT":
            s.lab_result, s.result_disease = "positive", "lsd"
            s.result_at = s.collected_at + timedelta(hours=30)
            c.status = "CONFIRMED"
            vv = db.get(Location, c.village_id)
            for role in ("block", "district"):
                db.add(Alert(kind="outbreak", severity="high",
                             title=f"LAB-CONFIRMED Lumpy Skin Disease in {vv.name}",
                             body=f"Sample {code} positive (ELISA). Containment active: "
                                  f"movement control + ring vaccination of 3-km zone.",
                             village_id=c.village_id, target_role=role))
        else:
            c.status = "SAMPLE_COLLECTED"
        db.add(s)
    # a treated + closed pair for history
    for c in lsd_cases[5:7]:
        # link the case to one of the farmer's animals so the health passport
        # shows a real treatment + milk-withdrawal countdown
        if c.farmer_id and not c.animal_id:
            an = db.query(Animal).filter(Animal.farmer_id == c.farmer_id).first()
            if an:
                c.animal_id = an.id
        db.add(Treatment(case_id=c.id, vet_id=vet.id,
                         diagnosis="LSD — clinical", treatment="Supportive: NSAID, "
                         "oxytetracycline LA, antiseptic dressing, fly control advised",
                         withdrawal_days=5,
                         given_at=datetime.utcnow() - timedelta(days=1)))
        c.status = "TREATMENT" if c is lsd_cases[5] else "CLOSED"
    # demo farmer: give him one treated animal too (passport demo)
    demo_fm = db.query(Farmer).filter(Farmer.user_id == demo_farmer_user.id).first()
    if demo_fm:
        my_case = (db.query(Case).filter(Case.farmer_id == demo_fm.id)
                     .order_by(Case.reported_at.desc()).first())
        my_animal = db.query(Animal).filter(Animal.farmer_id == demo_fm.id).first()
        if my_case and my_animal:
            my_case.animal_id = my_animal.id
            my_case.status = "TREATMENT"
            db.add(Treatment(case_id=my_case.id, vet_id=vet.id,
                             diagnosis="Suspected LSD — clinical",
                             treatment="Oxytetracycline LA + meloxicam; isolate; fly control",
                             withdrawal_days=7,
                             given_at=datetime.utcnow() - timedelta(days=2)))

    # -------------------------------------------------- claims (the loop) ---
    # Farmer with a death files a claim; three stages visible on first load
    demo_fm = db.query(Farmer).filter(Farmer.user_id == demo_farmer_user.id).first()
    death_cases = (db.query(Case).filter(Case.dead_count > 0)
                     .order_by(Case.reported_at).limit(4).all())
    statuses = ["APPROVED", "UNDER_REVIEW", "FILED"]
    for i, dc in enumerate(death_cases[:3]):
        if i == 2 and demo_fm:               # make the newest claim the demo farmer's
            dc.farmer_id = demo_fm.id
        amt = {"cattle": 37500, "buffalo": 37500, "goat": 4000,
               "sheep": 4000}.get(dc.species, 4000)
        cl = Claim(case_id=dc.id, farmer_id=dc.farmer_id, species=dc.species,
                   amount=amt, status=statuses[i],
                   filed_at=dc.reported_at + timedelta(hours=6))
        if statuses[i] == "APPROVED":
            cl.decided_at = cl.filed_at + timedelta(days=1)
            cl.note = "Verified against case record + para-vet confirmation"
        db.add(cl)

    # ---------------------------------------------------- camps upcoming ----
    home_v = db.get(Location, demo_fm.village_id) if demo_fm else None
    if home_v:
        db.add(Camp(village_id=home_v.id, disease_key="lsd",
                    camp_date=today + timedelta(days=3),
                    name=f"LSD ring-vaccination camp — {home_v.name}"))
        sib = [x for x in db.query(Location)
               .filter(Location.parent_id == home_v.parent_id).all()
               if x.id != home_v.id]
        if sib:
            db.add(Camp(village_id=sib[0].id, disease_key="fmd",
                        camp_date=today + timedelta(days=6),
                        name=f"FMD booster camp — {sib[0].name}"))
    ch = db.query(Location).filter_by(name="Chalisgaon", level="block").first()
    if ch and ch.children:
        db.add(Camp(village_id=ch.children[0].id, disease_key="fmd",
                    camp_date=today + timedelta(days=2),
                    name=f"FMD emergency camp — {ch.children[0].name}"))

    db.add(Alert(kind="vaccination", severity="medium",
                 title="LHDCP round due: FMD booster (Q3)",
                 body="Coverage gaps: Shevgaon 34%, Pathardi 38%, Chalisgaon 46%. "
                      "Ring-vaccination teams should prioritise these blocks this week.",
                 target_role="district"))
    db.add(Alert(kind="advisory", severity="medium",
                 title="Monsoon vector surge — statewide",
                 body="High humidity favours LSD vectors. Advise farmers: fly control, "
                      "neem-smoke in sheds, isolate any animal with skin nodules.",
                 target_role="block"))
    db.commit()
    return True


# ------------------------------------------------------------- simulator ----
NOISE = [
    ("cattle", ["itching"], 0), ("goat", ["diarrhoea", "anorexia"], 0),
    ("cattle", ["lameness"], 0), ("buffalo", ["low_milk", "anorexia"], 0),
    ("sheep", ["cough", "nasal_discharge"], 0), ("cattle", ["bloat"], 0),
    ("goat", ["itching"], 0), ("buffalo", ["anorexia"], 0),
]


def _mk_case(db, village, species, symptoms, dead, when, channel=None):
    t = triage(species, symptoms, dead_count=dead, month=when.month)
    fm = db.query(Farmer).filter(Farmer.village_id == village.id).first()
    c = Case(village_id=village.id, farmer_id=fm.id if fm else None,
             species=species, symptoms=",".join(symptoms),
             affected_count=rng.randint(1, 4), dead_count=dead,
             onset_date=when.date(), reported_at=when,
             channel=channel or rng.choice(["app", "app", "field", "ivr", "sms"]),
             lat=village.lat + rng.uniform(-0.012, 0.012),
             lon=village.lon + rng.uniform(-0.012, 0.012),
             triage_band=t["band"], triage_score=t["score"],
             suspected=t["suspected"], zoonotic_flag=t["zoonotic"],
             status="TRIAGED")
    db.add(c)
    return c


def _background_noise(db, villages, days=28):
    now = datetime.utcnow()
    for d in range(days, 0, -1):
        for _ in range(rng.randint(2, 5)):
            v = rng.choice(villages)
            sp, sym, dead = rng.choice(NOISE)
            _mk_case(db, v, sp, sym, dead,
                     now - timedelta(days=d, hours=rng.randint(0, 20)))


def _wave_day(db, zone_villages, origin, day, when, syndromes, species,
              horizon_km, growth, base, death_after, death_p, key_sym):
    """Epidemic wave: distance-decayed transmission + ~40% under-reporting."""
    intensity = min(1.0, base + day * growth)
    for v in zone_villages:
        dist = haversine_km(origin.lat, origin.lon, v.lat, v.lon)
        p = intensity * max(0.0, 1.0 - dist / horizon_km)
        n = rng.randint(1, 3 if dist < 10 else 2) if rng.random() < p else 0
        for _ in range(n):
            if rng.random() < 0.4:          # under-reporting
                continue
            dead = 1 if (day > death_after and rng.random() < death_p) else 0
            syms = rng.sample(syndromes, k=min(len(syndromes), rng.randint(2, 4)))
            if key_sym not in syms:
                syms.append(key_sym)
            _mk_case(db, v, rng.choice(species), syms, dead,
                     when + timedelta(hours=rng.randint(0, 20)))


_counter = {"n": 0}


def advance_outbreak_day(db):
    """Demo control: one more day of LSD + FMD spread 'today'."""
    _counter["n"] += 1
    day_lsd = min(15, 10 + _counter["n"])
    day_fmd = min(12, 6 + _counter["n"])
    now = datetime.utcnow() - timedelta(hours=2)
    n0 = db.query(Case).count()

    def block_villages(bname):
        blk = db.query(Location).filter_by(name=bname, level="block").first()
        return [c for c in blk.children if c.level == "village"]

    lsd_zone = sum((block_villages(b) for b in
                    ("Shevgaon", "Pathardi", "Nevasa", "Rahuri")), [])
    _wave_day(db, lsd_zone, origin=lsd_zone[0], day=day_lsd, when=now,
              syndromes=["fever", "nodules", "low_milk", "anorexia"],
              species=["cattle", "cattle", "buffalo"], horizon_km=32,
              growth=0.13, base=0.16, death_after=5, death_p=0.14,
              key_sym="nodules")
    fmd_zone = block_villages("Chalisgaon") + block_villages("Erandol")
    _wave_day(db, fmd_zone, origin=fmd_zone[0], day=day_fmd, when=now,
              syndromes=["oral_lesions", "hoof_lesions", "salivation", "fever"],
              species=["cattle", "buffalo"], horizon_km=24,
              growth=0.15, base=0.2, death_after=99, death_p=0,
              key_sym="oral_lesions")
    db.commit()
    return db.query(Case).count() - n0
