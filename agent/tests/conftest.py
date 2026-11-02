"""Database tests run on a throwaway Postgres given by TEST_DATABASE_URL (never the real project).
A fresh database `booking_test` is created with the migration and the demo clinic seed."""

import os
from pathlib import Path

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

SUPABASE_DIR = Path(__file__).resolve().parents[1] / "supabase"
TEST_DB = "booking_test"


@pytest.fixture(scope="session")
def db_url():
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("TEST_DATABASE_URL is not set")
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f"drop database if exists {TEST_DB} with (force)")
        admin.execute(f"create database {TEST_DB} encoding 'UTF8' template template0")
    url = make_conninfo(admin_url, dbname=TEST_DB)
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute((SUPABASE_DIR / "migrations" / "0001_booking_schema.sql").read_text(encoding="utf-8"))
        conn.execute((SUPABASE_DIR / "seed_demo_clinic.sql").read_text(encoding="utf-8"))
    return url


@pytest.fixture
def conn(db_url):
    """A connection like the agent's (autocommit; writes use their own transactions), on a clean calendar."""
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("delete from handoffs; delete from messages; delete from conversations; "
                  "delete from appointments; delete from time_off; delete from patients; "
                  "delete from clinics where slug <> 'demo-derma'")
        yield c
