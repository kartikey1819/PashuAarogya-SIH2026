"""Seed a database from a command line, instead of from a running server.

main.py seeds on startup, which suits a long-lived server and suits nothing
else. A serverless deployment never gets the chance -- its functions are too
short-lived for a thousand inserts -- so its database has to be filled from
somewhere with no timeout: a laptop, or a CI runner.

    python seed_cli.py                       # uses PASHU_DB_URL, else local SQLite
    python seed_cli.py "postgresql://..."    # or name the database outright

Safe to re-run: an already-populated database is topped up with whatever is
missing, never re-seeded over. Existing records are not touched.
"""
import sys
import os

# the URL may arrive as an argument; set it before database.py reads the env
if len(sys.argv) > 1 and sys.argv[1].strip():
    os.environ["PASHU_DB_URL"] = sys.argv[1].strip()

from database import Base, engine, SessionLocal   # noqa: E402
from models import Location, Animal, Case, User   # noqa: E402
import seed as seeder                             # noqa: E402
import engine as intel                            # noqa: E402
from sqlalchemy import func                       # noqa: E402


def main() -> int:
    url = str(engine.url)
    print(f"database : {url.split('@')[-1] if '@' in url else url}")
    if url.startswith("sqlite"):
        print("note     : this is a local SQLite file, not your cloud database.\n"
              "           Pass the URL as an argument, or set PASHU_DB_URL.")

    print("tables   : creating if absent ...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        print("seeding  : this takes a minute against a remote database ...")
        if seeder.seed_all(db):
            print("           fresh seed complete, computing risk scores ...")
            intel.refresh_all(db)
        else:
            added = seeder.seed_topup(db)
            print(f"           already populated; topped up: {added or 'nothing missing'}")
        db.commit()

        counts = {
            "locations": db.query(func.count(Location.id)).scalar(),
            "animals": db.query(func.count(Animal.id)).scalar(),
            "cases": db.query(func.count(Case.id)).scalar(),
            "users": db.query(func.count(User.id)).scalar(),
        }
    finally:
        db.close()

    print("\nDONE")
    for k, v in counts.items():
        print(f"  {k:10} {v}")
    if not counts["locations"]:
        print("\nWARNING: no locations were written — the database is still empty.")
        return 1
    print("\nLog in with phone 9000000001 and OTP 123456.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
