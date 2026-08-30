"""Database bootstrap. SQLite by default (zero-setup demo); set PASHU_DB_URL to a
PostgreSQL DSN to run on Postgres/PostGIS without code changes."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_URL = os.environ.get("PASHU_DB_URL", f"sqlite:///{os.path.join(BASE_DIR, 'pashuraksha.db')}")

engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
