"""Database bootstrap. SQLite by default (zero-setup demo); set PASHU_DB_URL to a
PostgreSQL DSN to run on Postgres/PostGIS without code changes."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# PASHU_DB_URL wins; DATABASE_URL is what Render/Heroku/Neon inject by default.
DB_URL = (os.environ.get("PASHU_DB_URL")
          or os.environ.get("DATABASE_URL")
          or f"sqlite:///{os.path.join(BASE_DIR, 'pashuraksha.db')}")
# SQLAlchemy 2 needs the postgresql:// scheme; managed hosts still hand out postgres://
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

# Name the driver explicitly. A bare postgresql:// URL lets SQLAlchemy pick the
# DBAPI, and that default is not stable across versions: 2.0 chooses psycopg2,
# newer releases choose psycopg (v3). We ship psycopg2-binary, so on a host that
# resolved a newer SQLAlchemy the app died at import with
# "ModuleNotFoundError: No module named 'psycopg'" -- before the port ever
# opened. Pinning the driver in the URL makes the choice ours, not pip's.
if DB_URL.startswith("postgresql://"):
    DB_URL = DB_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

_is_sqlite = DB_URL.startswith("sqlite")
# A wrong or unreachable Postgres host must fail fast, not hang: without a
# connect_timeout the driver waits on TCP for minutes, which on a platform
# looks like "the service never starts" rather than "the database is wrong".
_connect_args = ({"check_same_thread": False} if _is_sqlite
                 else {"connect_timeout": 10})
engine = create_engine(
    DB_URL,
    connect_args=_connect_args,
    # managed Postgres drops idle connections; recycle before it bites
    **({} if _is_sqlite else {"pool_pre_ping": True, "pool_recycle": 280}),
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
